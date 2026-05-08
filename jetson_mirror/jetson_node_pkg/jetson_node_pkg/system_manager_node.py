#!/usr/bin/env python3
import base64
import os
import signal
import shlex
import subprocess
import time

import rclpy
import requests
from rclpy.node import Node
from std_srvs.srv import Trigger
from jetson_interfaces.srv import StartNav

try:
    from geometry_msgs.msg import Twist
except ImportError:
    Twist = None

try:
    from motion_msgs.msg import MotionCtrl
except ImportError:
    MotionCtrl = None


def discover_server_url():
    """Discover a reachable local server URL by scanning the robot subnet."""
    import socket

    # Get robot's own IP to determine subnet
    robot_ip = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        robot_ip = s.getsockname()[0]
        s.close()
    except:
        pass

    # Build full IP range to scan (entire subnet)
    if robot_ip:
        parts = robot_ip.split('.')
        subnet = f'{parts[0]}.{parts[1]}.{parts[2]}'
        ips_to_try = [f'{subnet}.{i}' for i in range(1, 255)]
    else:
        # Fallback: common subnets - try all of them
        ips_to_try = []
        for subnet_prefix in ['192.168.1', '192.168.0', '192.168.2', '10.0.0']:
            ips_to_try.extend([f'{subnet_prefix}.{i}' for i in range(1, 255)])

    # Try /api/network endpoint on each IP in parallel with threading
    import threading
    result = {'url': None, 'lock': threading.Lock()}

    def try_ip(ip):
        if result['url']:
            return
        try:
            for port in (4101, 4001):
                resp = requests.get(f'http://{ip}:{port}/api/network', timeout=1)
                if resp.status_code != 200:
                    continue
                data = resp.json()
                if data.get('ips') and len(data['ips']) > 0:
                    server_ip = data['ips'][0]
                    discovered_port = data.get('port') or port
                    with result['lock']:
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
                t.join()
            threads = threads[50:]

    # Wait for remaining threads
    for t in threads:
        t.join()

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

        self.nav_motion_watchdog_active = False
        self.nav_motion_stance = 'crouch'
        self.nav_motion_last_cmd_time = None
        self.nav_motion_last_stop_time = 0.0

        # Use hardcoded server URL from parameter
        self.server_url = self.get_parameter('server_url').value
        self.get_logger().info(f'Server URL: {self.server_url}')

        self.motion_cmd_pub = None
        if MotionCtrl is not None:
            self.motion_cmd_pub = self.create_publisher(MotionCtrl, '/diablo/MotionCmd', 10)
        else:
            self.get_logger().warn('motion_msgs.msg.MotionCtrl is unavailable; stop_all will not publish an explicit stop command')

        self.cmd_vel_pub = None
        if Twist is not None:
            self.cmd_vel_pub = self.create_publisher(Twist, '/cmd_vel', 10)
            self.create_subscription(Twist, '/cmd_vel', self.handle_cmd_vel, 10)
            self.create_timer(0.1, self.handle_motion_watchdog)
        else:
            self.get_logger().warn('geometry_msgs.msg.Twist is unavailable; navigation cmd_vel watchdog is disabled')

        os.makedirs(self.maps_dir, exist_ok=True)

        self.create_service(Trigger, '/system/start_slam', self.handle_start_slam)
        self.create_service(StartNav, '/system/start_nav', self.handle_start_nav)
        self.create_service(Trigger, '/system/stop_all', self.handle_stop_all)
        self.create_service(Trigger, '/system/save_map', self.handle_save_map)
        self.create_service(Trigger, '/system/status', self.handle_status)

        self.get_logger().info('System Manager is ready.')

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
            msg.mode.height_ctrl_mode = True
            msg.mode.jump_mode = False
            msg.mode.split_mode = False
            msg.value.forward = 0.0
            msg.value.left = 0.0
            msg.value.up = 1.0 if stand_mode else 0.0
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
                '-p', 'save_map_timeout:=10.0',
                '-p', 'map_subscribe_transient_local:=true',
            ]
            result = subprocess.run(
                self.build_ros_command(ros_args),
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode == 0:
                yaml_path = f'{map_path}.yaml'
                pgm_path = f'{map_path}.pgm'

                if os.path.exists(yaml_path) and os.path.exists(pgm_path):
                    # Upload to server
                    try:
                        upload_base_url = self.resolve_map_upload_url()
                        with open(yaml_path, 'r') as f:
                            yaml_content = f.read()
                        with open(pgm_path, 'rb') as f:
                            pgm_content = base64.b64encode(f.read()).decode('utf-8')

                        upload_data = {
                            'name': map_name,
                            'yaml': yaml_content,
                            'pgm': pgm_content
                        }
                        upload_url = f'{upload_base_url}/api/maps/upload'
                        self.get_logger().info(f'Uploading map to {upload_url}...')
                        upload_resp = requests.post(upload_url, json=upload_data, timeout=30)
                        if upload_resp.status_code == 200:
                            self.get_logger().info('Map uploaded successfully')
                        else:
                            self.get_logger().warn(f'Upload failed: {upload_resp.status_code} {upload_resp.text}')
                    except Exception as upload_err:
                        self.get_logger().warn(f'Failed to upload map: {upload_err}')

                    response.success = True
                    response.message = f'Map saved: {yaml_path}'
                else:
                    response.success = False
                    response.message = 'Map files not found after save'
            else:
                response.success = False
                response.message = f'map_saver failed: {result.stderr}'
        except subprocess.TimeoutExpired:
            response.success = False
            response.message = 'Map save timed out'
        except Exception as e:
            response.success = False
            response.message = f'Failed: {e}'

        return response

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
