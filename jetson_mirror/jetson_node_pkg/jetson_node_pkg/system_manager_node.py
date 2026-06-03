#!/usr/bin/env python3
import json
import math
import os
import signal
import shlex
import subprocess
import threading
import time
from datetime import datetime, timezone

import rclpy
import requests
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy
from std_srvs.srv import Trigger
from jetson_interfaces.srv import StartNav
from std_msgs.msg import String

try:
    import yaml
except ImportError:
    yaml = None

try:
    from geometry_msgs.msg import PoseWithCovarianceStamped, Twist
except ImportError:
    PoseWithCovarianceStamped = None
    Twist = None

try:
    from nav_msgs.msg import OccupancyGrid
except ImportError:
    OccupancyGrid = None

try:
    from motion_msgs.msg import MotionCtrl
except ImportError:
    MotionCtrl = None


def discover_server_url():
    """Discover a reachable local server URL by scanning every local subnet."""
    import socket

    subnet_prefixes = []

    try:
        output = subprocess.check_output(
            ['hostname', '-I'],
            text=True,
            timeout=2,
        )
        for value in output.split():
            parts = value.split('.')
            if len(parts) == 4 and parts[0] not in ('127', '169'):
                subnet_prefixes.append('.'.join(parts[:3]))
    except:
        pass

    if not subnet_prefixes:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            parts = s.getsockname()[0].split('.')
            s.close()
            if len(parts) == 4:
                subnet_prefixes.append('.'.join(parts[:3]))
        except:
            pass

    for fallback_prefix in ['192.168.1', '192.168.43', '192.168.10', '192.168.0', '192.168.2', '10.0.0']:
        if fallback_prefix not in subnet_prefixes:
            subnet_prefixes.append(fallback_prefix)

    ips_to_try = []
    seen_ips = set()
    for subnet_prefix in subnet_prefixes:
        for i in range(1, 255):
            ip = f'{subnet_prefix}.{i}'
            if ip not in seen_ips:
                seen_ips.add(ip)
                ips_to_try.append(ip)

    # Try /api/network endpoint on each IP in parallel with threading
    import threading
    result = {'url': None, 'lock': threading.Lock()}

    def try_ip(ip):
        if result['url']:
            return
        try:
            for port in (4101, 4001):
                resp = requests.get(f'http://{ip}:{port}/api/network', timeout=0.35)
                if resp.status_code != 200:
                    continue
                data = resp.json()
                if data.get('ips') and len(data['ips']) > 0:
                    server_ip = data['ips'][0]
                    discovered_port = data.get('port') or port
                    with result['lock']:
                        if not result['url']:
                            result['url'] = f'http://{server_ip}:{discovered_port}'
                    return
        except:
            pass

    # Scan in parallel for speed
    threads = []
    for ip in ips_to_try:
        t = threading.Thread(target=try_ip, args=(ip,))
        t.start()
        threads.append(t)
        # Limit concurrent connections
        if len(threads) >= 50:
            for t in threads[:50]:
                t.join(timeout=0.5)
            if result['url']:
                break
            threads = threads[50:]

    # Wait for remaining threads
    for t in threads:
        t.join(timeout=0.5)
        if result['url']:
            break

    if result['url']:
        return result['url']

    return None


class SystemManager(Node):
    def __init__(self):
        super().__init__('system_manager_node')

        self.current_process = None
        self.process_name = None

        self.declare_parameter('maps_dir', '/home/nvidia/maps')
        self.declare_parameter('slam_package', 'jetson_node_pkg')
        self.declare_parameter('slam_launch_file', 'mapping_all.launch.py')
        self.declare_parameter('nav_package', 'jetson_node_pkg')
        self.declare_parameter('nav_launch_file', 'nav_all.launch.py')
        self.declare_parameter('stand_nav_launch_file', 'stand_nav_launch.py')
        self.declare_parameter('nav2_params_file', '')
        self.declare_parameter('slam_params_file', '/home/nvidia/ros2_ws/my_slam.yaml')
        self.declare_parameter('cmd_vel_timeout_sec', 0.5)
        self.declare_parameter('cmd_vel_stop_period_sec', 0.2)
        self.declare_parameter('fixed_initial_pose_delay_sec', 13.0)
        self.declare_parameter('server_url', 'http://182.43.86.126:4001')
        self.declare_parameter('cleanup_script', '/home/nvidia/webbot-cleanup-ros.sh')

        self.maps_dir = self.get_parameter('maps_dir').value
        self.slam_package = self.get_parameter('slam_package').value
        self.slam_launch_file = self.get_parameter('slam_launch_file').value
        self.nav_package = self.get_parameter('nav_package').value
        self.nav_launch_file = self.get_parameter('nav_launch_file').value
        self.stand_nav_launch_file = self.get_parameter('stand_nav_launch_file').value
        self.nav2_params_file = self.get_parameter('nav2_params_file').value
        self.slam_params_file = self.get_parameter('slam_params_file').value
        self.cleanup_script = self.get_parameter('cleanup_script').value
        self.cmd_vel_timeout_sec = float(self.get_parameter('cmd_vel_timeout_sec').value)
        self.cmd_vel_stop_period_sec = float(self.get_parameter('cmd_vel_stop_period_sec').value)
        self.fixed_initial_pose_delay_sec = float(self.get_parameter('fixed_initial_pose_delay_sec').value)
        self.nav_motion_watchdog_active = False
        self.nav_motion_stance = 'crouch'
        self.nav_motion_last_cmd_time = None
        self.nav_motion_last_stop_time = 0.0
        self.map_list_topic = '/system/map_list'
        self.static_map_topic = '/system/static_map'
        self.static_map_request_topic = '/system/request_static_map'
        self.map_edit_topic = '/system/edit_map'
        self.map_edit_result_topic = '/system/edit_map_result'

        # Use hardcoded server URL from parameter
        self.server_url = self.get_parameter('server_url').value
        self.get_logger().info(f'Server URL: {self.server_url}')

        self.motion_cmd_pub = None
        self.initial_pose_pub = None
        if MotionCtrl is not None:
            self.motion_cmd_pub = self.create_publisher(MotionCtrl, '/diablo/MotionCmd', 10)
        else:
            self.get_logger().warn('motion_msgs.msg.MotionCtrl is unavailable; stop_all will not publish an explicit stop command')

        if PoseWithCovarianceStamped is not None:
            self.initial_pose_pub = self.create_publisher(PoseWithCovarianceStamped, '/initialpose', 10)
            self.create_subscription(String, '/system/fixed_initialpose', self.handle_fixed_initial_pose, 10)
        else:
            self.get_logger().warn('geometry_msgs.msg.PoseWithCovarianceStamped is unavailable; fixed initial pose is disabled')

        self.create_subscription(String, self.static_map_request_topic, self.handle_static_map_request, 10)
        self.create_subscription(String, self.map_edit_topic, self.handle_edit_map, 10)

        self.cmd_vel_pub = None
        if Twist is not None:
            self.cmd_vel_pub = self.create_publisher(Twist, '/cmd_vel', 10)
            self.create_subscription(Twist, '/cmd_vel', self.handle_cmd_vel, 10)
            self.create_timer(0.1, self.handle_motion_watchdog)
        else:
            self.get_logger().warn('geometry_msgs.msg.Twist is unavailable; navigation cmd_vel watchdog is disabled')

        map_list_qos = QoSProfile(
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )
        self.map_list_pub = self.create_publisher(String, self.map_list_topic, map_list_qos)
        self.static_map_pub = None
        if OccupancyGrid is not None:
            self.static_map_pub = self.create_publisher(OccupancyGrid, self.static_map_topic, map_list_qos)
        else:
            self.get_logger().warn('nav_msgs.msg.OccupancyGrid is unavailable; static map publishing is disabled')
        self.map_edit_result_pub = self.create_publisher(String, self.map_edit_result_topic, map_list_qos)

        os.makedirs(self.maps_dir, exist_ok=True)

        self.create_service(Trigger, '/system/start_slam', self.handle_start_slam)
        self.create_service(StartNav, '/system/start_nav', self.handle_start_nav)
        self.create_service(Trigger, '/system/stop_all', self.handle_stop_all)
        self.create_service(Trigger, '/system/save_map', self.handle_save_map)
        self.create_service(Trigger, '/system/status', self.handle_status)

        self.publish_map_list()

        self.get_logger().info('System Manager is ready.')

    def get_fixed_initial_pose_path(self, map_yaml_file):
        root, _ = os.path.splitext(os.path.abspath(map_yaml_file))
        return f'{root}.initialpose.json'

    def get_map_identity(self, map_yaml_file):
        root, _ = os.path.splitext(os.path.basename(str(map_yaml_file)))
        return root

    def is_managed_process_running(self):
        return self.current_process is not None and self.current_process.poll() is None

    def resolve_map_paths(self, map_yaml_file):
        maps_dir = os.path.abspath(self.maps_dir)
        yaml_path = os.path.abspath(str(map_yaml_file))
        try:
            common_path = os.path.commonpath([maps_dir, yaml_path])
        except ValueError:
            common_path = ''

        if common_path != maps_dir:
            raise ValueError(f'map path is outside maps_dir: {map_yaml_file}')
        if not yaml_path.endswith('.yaml'):
            raise ValueError(f'map file must be a yaml file: {map_yaml_file}')
        if not os.path.exists(yaml_path):
            raise FileNotFoundError(f'map yaml not found: {yaml_path}')

        metadata = self.parse_map_yaml(yaml_path)
        image_path = str(metadata.get('image') or '').strip()
        if image_path:
            pgm_path = image_path
            if not os.path.isabs(pgm_path):
                pgm_path = os.path.join(os.path.dirname(yaml_path), pgm_path)
            pgm_path = os.path.abspath(pgm_path)
        else:
            root, _ = os.path.splitext(yaml_path)
            pgm_path = f'{root}.pgm'

        try:
            common_image_path = os.path.commonpath([maps_dir, pgm_path])
        except ValueError:
            common_image_path = ''
        if common_image_path != maps_dir:
            raise ValueError(f'map image path is outside maps_dir: {pgm_path}')
        if not os.path.exists(pgm_path):
            raise FileNotFoundError(f'map pgm not found: {pgm_path}')

        return yaml_path, pgm_path, metadata

    def parse_map_yaml(self, yaml_path):
        with open(yaml_path, 'r', encoding='utf-8') as file:
            text = file.read()

        if yaml is not None:
            payload = yaml.safe_load(text) or {}
        else:
            payload = {}
            for line in text.splitlines():
                stripped = line.split('#', 1)[0].strip()
                if ':' not in stripped:
                    continue
                key, value = stripped.split(':', 1)
                payload[key.strip()] = value.strip()

        origin = payload.get('origin', [0.0, 0.0, 0.0])
        if isinstance(origin, str):
            origin = json.loads(origin.replace("'", '"'))

        return {
            'image': payload.get('image', ''),
            'resolution': float(payload.get('resolution', 0.05)),
            'origin': [
                float(origin[0] if len(origin) > 0 else 0.0),
                float(origin[1] if len(origin) > 1 else 0.0),
                float(origin[2] if len(origin) > 2 else 0.0),
            ],
            'negate': int(payload.get('negate', 0)),
        }

    def parse_p5_pgm(self, pgm_path):
        with open(pgm_path, 'rb') as file:
            content = file.read()

        tokens = []
        index = 0
        length = len(content)
        while len(tokens) < 4:
            while index < length and content[index] in b' \t\r\n':
                index += 1
            if index < length and content[index] == ord('#'):
                while index < length and content[index] not in b'\r\n':
                    index += 1
                continue
            if index >= length:
                raise ValueError('unexpected end of PGM header')

            start = index
            while index < length and content[index] not in b' \t\r\n':
                index += 1
            tokens.append(content[start:index].decode('ascii'))

        if tokens[0] != 'P5':
            raise ValueError(f'unsupported PGM format: {tokens[0]}')
        width = int(tokens[1])
        height = int(tokens[2])
        max_value = int(tokens[3])
        if width <= 0 or height <= 0:
            raise ValueError(f'invalid PGM size: {width}x{height}')
        if max_value <= 0 or max_value > 255:
            raise ValueError(f'unsupported PGM max value: {max_value}')

        if index >= length or content[index] not in b' \t\r\n':
            raise ValueError('invalid PGM header terminator')
        if content[index:index + 2] == b'\r\n':
            index += 2
        else:
            index += 1

        pixel_count = width * height
        if len(content) - index < pixel_count:
            raise ValueError(f'PGM pixel data is truncated: expected {pixel_count}, got {len(content) - index}')

        return content, index, width, height, max_value

    def build_static_map_message(self, map_yaml_file, request_id):
        if OccupancyGrid is None:
            raise RuntimeError('OccupancyGrid message type is unavailable')

        yaml_path, pgm_path, metadata = self.resolve_map_paths(map_yaml_file)
        content, pixel_offset, width, height, max_value = self.parse_p5_pgm(pgm_path)
        pixels = content[pixel_offset:pixel_offset + width * height]
        data = [0] * (width * height)
        negate = metadata['negate'] != 0

        for row in range(height):
            for col in range(width):
                pgm_index = (height - 1 - row) * width + col
                normalized = pixels[pgm_index] / float(max_value)
                value = round(normalized * 100) if negate else round(100 - normalized * 100)
                data[row * width + col] = max(0, min(100, int(value)))

        now = self.get_clock().now().to_msg()
        origin_x, origin_y, origin_yaw = metadata['origin']
        map_name = self.get_map_identity(yaml_path)
        grid = OccupancyGrid()
        grid.header.stamp = now
        grid.header.frame_id = f'static_map|{request_id}|{map_name}'
        grid.info.map_load_time = now
        grid.info.resolution = metadata['resolution']
        grid.info.width = width
        grid.info.height = height
        grid.info.origin.position.x = origin_x
        grid.info.origin.position.y = origin_y
        grid.info.origin.position.z = 0.0
        grid.info.origin.orientation.x = 0.0
        grid.info.origin.orientation.y = 0.0
        grid.info.origin.orientation.z = math.sin(origin_yaw / 2.0)
        grid.info.origin.orientation.w = math.cos(origin_yaw / 2.0)
        grid.data = data
        return grid, map_name, yaml_path

    def handle_static_map_request(self, msg):
        try:
            payload = json.loads(msg.data or '{}')
            request_id = str(payload.get('requestId') or '').strip()
            map_yaml_file = str(payload.get('mapYamlFile') or payload.get('map_yaml_file') or '').strip()
            if not request_id or not map_yaml_file:
                self.get_logger().warn('Ignored static map request without requestId or mapYamlFile')
                return
            if self.static_map_pub is None:
                self.get_logger().warn('Ignored static map request because static map publisher is disabled')
                return

            grid, map_name, yaml_path = self.build_static_map_message(map_yaml_file, request_id)
            self.static_map_pub.publish(grid)
            self.get_logger().info(f'Published static map {map_name} for request {request_id}: {yaml_path}')
        except Exception as exc:
            self.get_logger().warn(f'Failed to publish static map: {exc}')

    def publish_map_edit_result(self, request_id, map_name, success, message, changed_count=0, backup_path=''):
        result = String()
        result.data = json.dumps({
            'requestId': request_id,
            'mapName': map_name,
            'success': bool(success),
            'message': str(message),
            'changedCount': int(changed_count),
            'backupPath': backup_path,
        }, ensure_ascii=True)
        self.map_edit_result_pub.publish(result)

    def handle_edit_map(self, msg):
        request_id = ''
        map_name = ''
        try:
            payload = json.loads(msg.data or '{}')
            request_id = str(payload.get('requestId') or '').strip()
            map_yaml_file = str(payload.get('mapYamlFile') or payload.get('map_yaml_file') or '').strip()
            operation = str(payload.get('operation') or '').strip()
            cells = payload.get('cells')
            map_name = self.get_map_identity(map_yaml_file)

            if not request_id or not map_yaml_file:
                raise ValueError('requestId and mapYamlFile are required')
            if operation != 'erase':
                raise ValueError(f'unsupported operation: {operation}')
            if self.is_managed_process_running():
                raise RuntimeError(f'cannot edit map while {self.process_name} is running')
            if not isinstance(cells, list) or not cells:
                raise ValueError('cells must be a non-empty list')
            if len(cells) > 200000:
                raise ValueError(f'too many cells: {len(cells)}')

            yaml_path, pgm_path, _ = self.resolve_map_paths(map_yaml_file)
            map_name = self.get_map_identity(yaml_path)
            content, pixel_offset, width, height, max_value = self.parse_p5_pgm(pgm_path)
            pixel_count = width * height
            edited = bytearray(content)
            changed_count = 0
            seen = set()

            for cell in cells:
                try:
                    index = int(cell)
                except (TypeError, ValueError):
                    continue
                if index < 0 or index >= pixel_count or index in seen:
                    continue
                seen.add(index)
                row = index // width
                col = index % width
                pgm_index = (height - 1 - row) * width + col
                pixel_index = pixel_offset + pgm_index
                if edited[pixel_index] != max_value:
                    edited[pixel_index] = max_value
                    changed_count += 1

            if changed_count == 0:
                self.publish_map_edit_result(request_id, map_name, True, 'no pixel changes', 0, '')
                return

            timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            backup_path = f'{pgm_path}.bak_{timestamp}'
            tmp_path = f'{pgm_path}.tmp'
            with open(backup_path, 'wb') as file:
                file.write(content)
            with open(tmp_path, 'wb') as file:
                file.write(edited)
            os.replace(tmp_path, pgm_path)
            self.publish_map_edit_result(request_id, map_name, True, 'map edited', changed_count, backup_path)
            self.get_logger().info(f'Erased {changed_count} cells in {pgm_path}; backup={backup_path}')
        except Exception as exc:
            self.get_logger().warn(f'Failed to edit map: {exc}')
            self.publish_map_edit_result(request_id, map_name, False, str(exc), 0, '')

    def handle_fixed_initial_pose(self, msg):
        try:
            payload = json.loads(msg.data or '{}')
            map_yaml_file = str(payload.get('mapYamlFile') or payload.get('map_yaml_file') or '').strip()
            x = float(payload.get('x'))
            y = float(payload.get('y'))
            theta = float(payload.get('theta', 0.0))

            if not map_yaml_file:
                self.get_logger().warn('Ignored fixed initial pose without mapYamlFile')
                return
            if not os.path.exists(map_yaml_file):
                self.get_logger().warn(f'Ignored fixed initial pose for missing map: {map_yaml_file}')
                return
            if not all(math.isfinite(value) for value in (x, y, theta)):
                self.get_logger().warn(f'Ignored fixed initial pose with invalid values: {payload}')
                return

            pose_file = self.get_fixed_initial_pose_path(map_yaml_file)
            record = {
                'map_yaml_file': os.path.abspath(map_yaml_file),
                'frame_id': 'map',
                'x': x,
                'y': y,
                'theta': theta,
                'saved_at': datetime.now(timezone.utc).isoformat(),
            }

            tmp_file = f'{pose_file}.tmp'
            with open(tmp_file, 'w', encoding='utf-8') as file:
                json.dump(record, file, ensure_ascii=True, indent=2)
                file.write('\n')
            os.replace(tmp_file, pose_file)
            self.get_logger().info(f'Saved fixed initial pose for {map_yaml_file}: x={x:.3f}, y={y:.3f}, theta={theta:.3f}')
        except Exception as exc:
            self.get_logger().warn(f'Failed to save fixed initial pose: {exc}')

    def load_fixed_initial_pose(self, map_yaml_file):
        pose_file = self.get_fixed_initial_pose_path(map_yaml_file)
        if not os.path.exists(pose_file):
            return None

        try:
            with open(pose_file, 'r', encoding='utf-8') as file:
                payload = json.load(file)

            x = float(payload.get('x'))
            y = float(payload.get('y'))
            theta = float(payload.get('theta', 0.0))
            if not all(math.isfinite(value) for value in (x, y, theta)):
                raise ValueError(f'invalid pose values: {payload}')

            return {'x': x, 'y': y, 'theta': theta}
        except Exception as exc:
            self.get_logger().warn(f'Failed to load fixed initial pose {pose_file}: {exc}')
            return None

    def schedule_fixed_initial_pose_publish(self, map_yaml_file, nav_pid):
        pose = self.load_fixed_initial_pose(map_yaml_file)
        if pose is None:
            self.get_logger().info(f'No fixed initial pose for map: {map_yaml_file}')
            return

        thread = threading.Thread(
            target=self.publish_fixed_initial_pose_after_nav_ready,
            args=(map_yaml_file, pose, nav_pid),
            daemon=True,
        )
        thread.start()

    def publish_fixed_initial_pose_after_nav_ready(self, map_yaml_file, pose, nav_pid):
        time.sleep(max(0.0, self.fixed_initial_pose_delay_sec))

        if self.current_process is None or self.current_process.pid != nav_pid or self.current_process.poll() is not None:
            self.get_logger().info(f'Skipped fixed initial pose publish because navigation is no longer running: {map_yaml_file}')
            return

        for index in range(8):
            if self.current_process is None or self.current_process.pid != nav_pid or self.current_process.poll() is not None:
                return
            self.publish_initial_pose(pose['x'], pose['y'], pose['theta'])
            if index < 7:
                time.sleep(0.5)

        self.get_logger().info(
            f'Published fixed initial pose for {map_yaml_file}: x={pose["x"]:.3f}, y={pose["y"]:.3f}, theta={pose["theta"]:.3f}'
        )

    def publish_initial_pose(self, x, y, theta):
        if self.initial_pose_pub is None or PoseWithCovarianceStamped is None:
            return

        msg = PoseWithCovarianceStamped()
        msg.header.frame_id = 'map'
        msg.pose.pose.position.x = float(x)
        msg.pose.pose.position.y = float(y)
        msg.pose.pose.position.z = 0.0
        msg.pose.pose.orientation.x = 0.0
        msg.pose.pose.orientation.y = 0.0
        msg.pose.pose.orientation.z = math.sin(float(theta) / 2.0)
        msg.pose.pose.orientation.w = math.cos(float(theta) / 2.0)
        msg.pose.covariance = [
            0.25, 0.0, 0.0, 0.0, 0.0, 0.0,
            0.0, 0.25, 0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0685389192,
        ]
        self.initial_pose_pub.publish(msg)

    def cleanup_residual_processes(self):
        cleanup_script = str(self.cleanup_script or '').strip()
        if cleanup_script and os.path.exists(cleanup_script):
            try:
                subprocess.run(['/bin/bash', cleanup_script], capture_output=True, timeout=20)
                return
            except Exception as exc:
                self.get_logger().warn(f'Cleanup script failed, falling back to pkill set: {exc}')

        patterns = [
            'mapping_all.launch.py',
            'nav_all.launch.py',
            'stand_nav_launch.py',
            'slam_toolbox',
            'async_slam_toolbox_node',
            'online_async',
            'fastlio_mapping',
            'livox_ros_driver2',
            'livox_ros_driver2_node',
            'pointcloud_to_laserscan',
            'pointcloud_to_laserscan_node',
            'base_footprint_projector',
            'cmd_vel_converter',
            'stand_cmd_vel_converter',
            'amcl',
            'map_server',
            'planner_server',
            'controller_server',
            'behavior_server',
            'smoother_server',
            'bt_navigator',
            'lifecycle_manager',
            'waypoint_follower',
            'velocity_smoother',
            'recoveries_server',
            'robot_state_publisher',
            'nav2_bringup',
            'navigation_launch',
            'gz sim',
        ]
        for sig in ('TERM', 'KILL'):
            for pattern in patterns:
                subprocess.run(['pkill', f'-{sig}', '-f', pattern], capture_output=True)
            time.sleep(1)

    def build_ros_command(self, args):
        quoted_args = ' '.join(shlex.quote(arg) for arg in args)
        return [
            '/bin/bash',
            '-lc',
            'set +u; '
            'source /opt/ros/humble/setup.bash; '
            'source ~/livox_ws/install/setup.bash >/dev/null 2>&1 || true; '
            'source ~/ros2_ws/install/setup.bash >/dev/null 2>&1 || true; '
            'set -u; '
            f'exec {quoted_args}',
        ]

    def kill_current_process(self):
        # Save process name for fallback kill
        process_name_to_kill = self.process_name
        had_process = self.current_process is not None

        if self.current_process is not None:
            self.get_logger().info(f'Stopping {self.process_name}...')
            try:
                if self.current_process.poll() is None:
                    # Use process group to kill parent and all children
                    try:
                        os.killpg(os.getpgid(self.current_process.pid), signal.SIGTERM)
                    except (ProcessLookupError, OSError):
                        pass
                    try:
                        self.current_process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(os.getpgid(self.current_process.pid), signal.SIGKILL)
                        except (ProcessLookupError, OSError):
                            pass
            except Exception as e:
                self.get_logger().warn(f'Error stopping process: {e}')

            self.current_process = None
            self.process_name = None

        if process_name_to_kill == 'navigation':
            self.disable_nav_motion_watchdog()

        # Avoid running the expensive cleanup path on a clean idle start.
        # Systemd already performs a broader cleanup before the service comes up.
        if had_process:
            self.cleanup_residual_processes()

    def enable_nav_motion_watchdog(self, stance):
        self.nav_motion_watchdog_active = True
        self.nav_motion_stance = stance
        self.nav_motion_last_cmd_time = time.monotonic()
        self.nav_motion_last_stop_time = 0.0
        self.get_logger().info(
            f'Navigation cmd_vel watchdog enabled: timeout={self.cmd_vel_timeout_sec:.2f}s, stance={stance}'
        )

    def disable_nav_motion_watchdog(self):
        if self.nav_motion_watchdog_active:
            self.get_logger().info('Navigation cmd_vel watchdog disabled')
        self.nav_motion_watchdog_active = False
        self.nav_motion_last_cmd_time = None
        self.nav_motion_last_stop_time = 0.0

    def handle_cmd_vel(self, msg):
        if self.nav_motion_watchdog_active:
            self.nav_motion_last_cmd_time = time.monotonic()

    def handle_motion_watchdog(self):
        if not self.nav_motion_watchdog_active:
            return

        if self.current_process is None or self.current_process.poll() is not None:
            self.disable_nav_motion_watchdog()
            return

        if self.nav_motion_last_cmd_time is None:
            self.nav_motion_last_cmd_time = time.monotonic()
            return

        now = time.monotonic()
        if now - self.nav_motion_last_cmd_time <= self.cmd_vel_timeout_sec:
            return

        if now - self.nav_motion_last_stop_time < self.cmd_vel_stop_period_sec:
            return

        self.nav_motion_last_stop_time = now
        self.publish_zero_cmd_vel()
        self.publish_stop_motion(self.nav_motion_stance, repeat=1)

    def publish_zero_cmd_vel(self):
        if self.cmd_vel_pub is None or Twist is None:
            return

        try:
            self.cmd_vel_pub.publish(Twist())
        except Exception as exc:
            self.get_logger().warn(f'Failed to publish zero cmd_vel: {exc}')

    def publish_stop_motion(self, stance='crouch', repeat=3):
        if self.motion_cmd_pub is None or MotionCtrl is None:
            return

        try:
            stand_mode = stance == 'stand'
            msg = MotionCtrl()
            msg.mode_mark = False
            msg.mode.stand_mode = stand_mode
            msg.mode.pitch_ctrl_mode = False
            msg.mode.roll_ctrl_mode = False
            msg.mode.height_ctrl_mode = False
            msg.mode.jump_mode = False
            msg.mode.split_mode = False
            msg.value.forward = 0.0
            msg.value.left = 0.0
            msg.value.up = 1.0
            msg.value.roll = 0.0
            msg.value.pitch = 0.0
            msg.value.leg_split = 0.0

            # Publish a few times to make the stop command more robust against transient loss.
            for index in range(repeat):
                self.motion_cmd_pub.publish(msg)
                if index < repeat - 1:
                    time.sleep(0.05)
        except Exception as exc:
            self.get_logger().warn(f'Failed to publish stop motion command: {exc}')

    def handle_start_slam(self, request, response):
        self.kill_current_process()
        self.get_logger().info('Starting SLAM...')

        try:
            ros_args = ['ros2', 'launch', self.slam_package, self.slam_launch_file]

            slam_params_file = str(self.slam_params_file or '').strip()
            if slam_params_file:
                if not os.path.exists(slam_params_file):
                    response.success = False
                    response.message = f'SLAM params file not found: {slam_params_file}'
                    return response
                ros_args.append(f'slam_params_file:={slam_params_file}')

            ros_args.append('pointcloud_target_frame:=base_footprint')
            cmd = self.build_ros_command(ros_args)
            self.current_process = subprocess.Popen(cmd, start_new_session=True)
            self.process_name = 'slam'

            response.success = True
            response.message = f'SLAM started (PID: {self.current_process.pid})'
        except Exception as e:
            self.get_logger().error(f'Failed to start SLAM: {e}')
            response.success = False
            response.message = f'Failed to start SLAM: {e}'

        return response

    def handle_start_nav(self, request, response):
        self.kill_current_process()

        map_yaml_file = request.map_yaml_file.strip()
        if not map_yaml_file:
            response.success = False
            response.message = 'map_yaml_file is empty'
            return response

        if not os.path.exists(map_yaml_file):
            response.success = False
            response.message = f'map file not found: {map_yaml_file}'
            return response

        stance = (getattr(request, 'stance', 'crouch') or 'crouch').strip().lower()
        if stance not in {'stand', 'crouch'}:
            response.success = False
            response.message = f'Invalid stance: {stance}'
            return response

        speed = (getattr(request, 'speed', 'high') or 'high').strip().lower()
        if speed not in {'high', 'medium', 'low'}:
            response.success = False
            response.message = f'Invalid speed: {speed}'
            return response

        # Select launch file based on stance
        if stance == 'stand':
            nav_launch_file = self.stand_nav_launch_file
            self.get_logger().info(f'Starting Stand Navigation with map: {map_yaml_file}, speed: {speed}')
        else:
            nav_launch_file = self.nav_launch_file
            self.get_logger().info(f'Starting Crouch Navigation with map: {map_yaml_file}, speed: {speed}')

        try:
            ros_args = [
                'ros2', 'launch',
                self.nav_package,
                nav_launch_file,
                f'map:={map_yaml_file}',
                f'speed:={speed}',
            ]

            nav2_params_file = str(self.nav2_params_file or '').strip()
            if nav2_params_file:
                if not os.path.exists(nav2_params_file):
                    response.success = False
                    response.message = f'Nav2 params file not found: {nav2_params_file}'
                    return response
                ros_args.append(f'params_file:={nav2_params_file}')

            cmd = self.build_ros_command(ros_args)

            self.current_process = subprocess.Popen(cmd, start_new_session=True)
            self.process_name = 'navigation'
            self.enable_nav_motion_watchdog(stance)
            self.schedule_fixed_initial_pose_publish(map_yaml_file, self.current_process.pid)

            self.get_logger().info(f'Started Navigation with PID: {self.current_process.pid}, stance: {stance}, speed: {speed}')
            response.success = True
            response.message = f'Navigation started with map: {map_yaml_file} (stance: {stance}, speed: {speed})'
        except Exception as e:
            self.get_logger().error(f'Failed to start Navigation: {e}')
            response.success = False
            response.message = f'Failed to start Navigation: {e}'

        return response

    def handle_stop_all(self, request, response):
        stop_stance = self.nav_motion_stance if self.nav_motion_watchdog_active else 'crouch'
        self.publish_zero_cmd_vel()
        self.publish_stop_motion(stop_stance)
        self.kill_current_process()
        self.publish_zero_cmd_vel()
        self.publish_stop_motion(stop_stance)
        response.success = True
        response.message = 'All tasks stopped'
        return response

    def handle_save_map(self, request, response):
        self.get_logger().info('Saving map...')
        map_name = f'map_{int(time.time())}'
        map_path = os.path.join(self.maps_dir, map_name)

        try:
            ros_args = [
                'ros2', 'run', 'nav2_map_server', 'map_saver_cli',
                '-f', map_path,
                '--ros-args',
                '-p', 'save_map_timeout:=20.0',
                '-p', 'map_subscribe_transient_local:=true',
            ]
            result = None
            attempts = 2
            last_error = ''
            for attempt in range(1, attempts + 1):
                result = subprocess.run(
                    self.build_ros_command(ros_args),
                    capture_output=True,
                    text=True,
                    timeout=45,
                )
                stderr = (result.stderr or '').strip()
                stdout = (result.stdout or '').strip()
                combined = '\n'.join(part for part in [stderr, stdout] if part).strip()
                last_error = combined or f'rc={result.returncode}'

                if result.returncode == 0:
                    break

                if 'Failed to spin map subscription' in last_error and attempt < attempts:
                    self.get_logger().warn(
                        f'map_saver subscription was not ready on attempt {attempt}, retrying once...'
                    )
                    time.sleep(1.0)
                    continue

                break

            if result and result.returncode == 0:
                yaml_path = f'{map_path}.yaml'
                pgm_path = f'{map_path}.pgm'

                if os.path.exists(yaml_path) and os.path.exists(pgm_path):
                    try:
                        self.publish_map_list()
                    except Exception as publish_err:
                        self.get_logger().warn(f'Failed to publish map list: {publish_err}')

                    response.success = True
                    response.message = f'Map saved: {yaml_path}'
                else:
                    response.success = False
                    response.message = 'Map files not found after save'
            else:
                response.success = False
                response.message = f'map_saver failed: {last_error}'
        except subprocess.TimeoutExpired:
            response.success = False
            response.message = 'Map save timed out'
        except Exception as e:
            response.success = False
            response.message = f'Failed: {e}'

        return response

    def build_map_list_payload(self):
        maps = []
        try:
            for entry in sorted(os.listdir(self.maps_dir)):
                if not entry.endswith('.yaml'):
                    continue
                map_name = entry[:-5]
                yaml_path = os.path.join(self.maps_dir, entry)
                pgm_path = os.path.join(self.maps_dir, f'{map_name}.pgm')
                if not os.path.exists(pgm_path):
                    continue

                stats = os.stat(yaml_path)
                maps.append({
                    'name': map_name,
                    'filename': entry,
                    'path': yaml_path,
                    'created': datetime.fromtimestamp(stats.st_mtime, tz=timezone.utc).isoformat(),
                })
        except Exception as exc:
            self.get_logger().warn(f'Failed to build map list payload: {exc}')
        return maps

    def publish_map_list(self):
        map_list = self.build_map_list_payload()
        message = String()
        message.data = json.dumps({'maps': map_list}, ensure_ascii=True)
        self.map_list_pub.publish(message)
        self.get_logger().info(f'Published map list with {len(map_list)} entries on {self.map_list_topic}')

    def resolve_map_upload_url(self):
        discovered_url = discover_server_url()
        if discovered_url:
            if discovered_url != self.server_url:
                self.get_logger().info(
                    f'Using discovered local server for map upload: {discovered_url} (fallback: {self.server_url})'
                )
            return discovered_url

        return self.server_url

    def handle_status(self, request, response):
        status = 'idle'
        pid = ''

        if self.current_process is not None:
            if self.current_process.poll() is None:
                status = self.process_name
                pid = str(self.current_process.pid)
            else:
                self.current_process = None
                self.process_name = None

        response.success = True
        response.message = f'{status}|{pid}'
        return response


def main(args=None):
    rclpy.init(args=args)
    node = SystemManager()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.kill_current_process()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
