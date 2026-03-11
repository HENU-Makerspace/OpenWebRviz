#!/usr/bin/env python3
import os
import signal
import subprocess
import time

import rclpy
from rclpy.node import Node
from std_srvs.srv import Trigger
from jetson_interfaces.srv import StartNav


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
        self.declare_parameter('nav2_params_file', '/home/nvidia/ros2_ws/my_nav2_params.yaml')

        self.maps_dir = self.get_parameter('maps_dir').value
        self.slam_package = self.get_parameter('slam_package').value
        self.slam_launch_file = self.get_parameter('slam_launch_file').value
        self.nav_package = self.get_parameter('nav_package').value
        self.nav_launch_file = self.get_parameter('nav_launch_file').value
        self.nav2_params_file = self.get_parameter('nav2_params_file').value

        os.makedirs(self.maps_dir, exist_ok=True)

        self.create_service(Trigger, '/system/start_slam', self.handle_start_slam)
        self.create_service(StartNav, '/system/start_nav', self.handle_start_nav)
        self.create_service(Trigger, '/system/stop_all', self.handle_stop_all)
        self.create_service(Trigger, '/system/save_map', self.handle_save_map)
        self.create_service(Trigger, '/system/status', self.handle_status)

        self.get_logger().info('System Manager is ready.')

    def kill_current_process(self):
        if self.current_process is not None:
            self.get_logger().info(f'Stopping {self.process_name}...')
            try:
                if self.current_process.poll() is None:
                    self.current_process.send_signal(signal.SIGINT)
                    try:
                        self.current_process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        self.get_logger().warn('Process did not exit gracefully, forcing kill...')
                        self.current_process.kill()
                        self.current_process.wait()
            except Exception as e:
                self.get_logger().warn(f'Error stopping process: {e}')

            self.current_process = None
            self.process_name = None

    def handle_start_slam(self, request, response):
        self.kill_current_process()
        self.get_logger().info('Starting SLAM...')

        try:
            cmd = ['ros2', 'launch', self.slam_package, self.slam_launch_file]
            self.current_process = subprocess.Popen(cmd)
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

        self.get_logger().info(f'Starting Navigation with map: {map_yaml_file}')

        try:
            cmd = [
                'ros2', 'launch',
                self.nav_package,
                self.nav_launch_file,
                f'map_yaml_file:={map_yaml_file}',
                f'nav2_params_file:={self.nav2_params_file}',
            ]

            self.current_process = subprocess.Popen(cmd)
            self.process_name = 'navigation'

            self.get_logger().info(f'Started Navigation with PID: {self.current_process.pid}')
            response.success = True
            response.message = f'Navigation started with map: {map_yaml_file}'
        except Exception as e:
            self.get_logger().error(f'Failed to start Navigation: {e}')
            response.success = False
            response.message = f'Failed to start Navigation: {e}'

        return response

    def handle_stop_all(self, request, response):
        self.kill_current_process()
        response.success = True
        response.message = 'All tasks stopped'
        return response

    def handle_save_map(self, request, response):
        self.get_logger().info('Saving map...')
        map_name = f'map_{int(time.time())}'
        map_path = os.path.join(self.maps_dir, map_name)

        try:
            cmd = ['ros2', 'run', 'nav2_map_server', 'map_saver_cli', '-f', map_path]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

            if result.returncode == 0:
                yaml_path = f'{map_path}.yaml'
                pgm_path = f'{map_path}.pgm'

                if os.path.exists(yaml_path) and os.path.exists(pgm_path):
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