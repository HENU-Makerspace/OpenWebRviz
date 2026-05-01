import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, OpaqueFunction, TimerAction
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def _resolve_params_file(context, speed_params):
    explicit_params = context.launch_configurations.get('params_file', '').strip()
    if explicit_params:
        return explicit_params

    speed = context.launch_configurations.get('speed', 'high')
    return speed_params.get(speed, speed_params['high'])


def _nav2_bringup(context, nav2_bringup_dir, map_yaml_file, use_sim_time, speed_params):
    params_file = _resolve_params_file(context, speed_params)
    return [
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(
                os.path.join(nav2_bringup_dir, 'launch', 'bringup_launch.py')
            ),
            launch_arguments={
                'map': map_yaml_file,
                'params_file': params_file,
                'use_sim_time': use_sim_time,
                'use_composition': 'False',
                'autostart': 'True',
            }.items(),
        ),
    ]


def generate_launch_description():
    fast_lio_dir = get_package_share_directory('fast_lio')
    livox_driver_dir = get_package_share_directory('livox_ros_driver2')
    nav2_bringup_dir = get_package_share_directory('nav2_bringup')

    map_yaml_file = LaunchConfiguration('map', default='/home/nvidia/ros2_ws/my_map.yaml')
    use_sim_time = LaunchConfiguration('use_sim_time', default='false')
    speed = LaunchConfiguration('speed', default='high')
    pointcloud_target_frame = LaunchConfiguration('pointcloud_target_frame', default='base_footprint')

    speed_params = {
        'high': '/home/nvidia/ros2_ws/my_nav2_params.yaml',
        'medium': '/home/nvidia/ros2_ws/my_nav2_params_medium.yaml',
        'low': '/home/nvidia/ros2_ws/my_nav2_params_low.yaml',
    }

    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false'),
        DeclareLaunchArgument('map', default_value='/home/nvidia/ros2_ws/my_map.yaml'),
        DeclareLaunchArgument('speed', default_value='high', description='Speed: high, medium, low'),
        DeclareLaunchArgument('params_file', default_value=''),
        DeclareLaunchArgument('pointcloud_target_frame', default_value='base_footprint'),
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(
                os.path.join(livox_driver_dir, 'launch_ROS2', 'msg_MID360_launch.py')
            ),
            launch_arguments={'use_sim_time': use_sim_time}.items(),
        ),
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(
                os.path.join(fast_lio_dir, 'launch', 'mapping.launch.py')
            ),
            launch_arguments={'rviz': 'false', 'use_sim_time': use_sim_time}.items(),
        ),
        Node(
            package='tf2_ros',
            executable='static_transform_publisher',
            name='odom_to_camera_init',
            arguments=[
                '--x', '0',
                '--y', '0',
                '--z', '0',
                '--qx', '0',
                '--qy', '0',
                '--qz', '0',
                '--qw', '1',
                '--frame-id', 'odom',
                '--child-frame-id', 'camera_init',
            ],
            parameters=[{'use_sim_time': use_sim_time}],
        ),
        Node(
            package='tf2_ros',
            executable='static_transform_publisher',
            name='base_link_to_camera_link',
            arguments=[
                '--x', '0.15',
                '--y', '0',
                '--z', '0.15',
                '--qx', '0',
                '--qy', '0',
                '--qz', '0',
                '--qw', '1',
                '--frame-id', 'base_link',
                '--child-frame-id', 'camera_link',
            ],
            parameters=[{'use_sim_time': use_sim_time}],
        ),
        Node(
            package='jetson_node_pkg',
            executable='base_footprint_projector',
            name='base_footprint_projector',
            output='screen',
            parameters=[{
                'odom_topic': '/Odometry',
                'odom_frame': 'camera_init',
                'base_footprint_frame': 'base_footprint',
                'base_link_frame': 'base_link',
                'body_to_base_x': 0.05,
                'body_to_base_y': 0.0,
                'base_link_z': -0.25,
                'use_sim_time': use_sim_time,
            }],
        ),
        Node(
            package='pointcloud_to_laserscan',
            executable='pointcloud_to_laserscan_node',
            name='pointcloud_to_laserscan',
            remappings=[('cloud_in', '/cloud_registered_body'), ('scan', '/scan')],
            parameters=[{
                'target_frame': pointcloud_target_frame,
                'transform_tolerance': 0.3,
                'min_height': -0.05,
                'max_height': 2.0,
                'angle_min': -3.14159,
                'angle_max': 3.14159,
                'angle_increment': 0.0087,
                'scan_time': 0.1,
                'range_min': 0.3,
                'range_max': 10.0,
                'use_inf': True,
                'use_sim_time': use_sim_time,
            }],
        ),
        Node(
            package='mqtt_client',
            executable='mqtt_client',
            name='mqtt_client',
            output='screen',
            parameters=['/home/nvidia/ros2_ws/src/mqtt_client/mqtt_client/config/params.yaml'],
        ),
        Node(
            package='jetson_node_pkg',
            executable='cmd_vel_converter',
            name='cmd_vel_converter',
            output='screen',
        ),
        TimerAction(
            period=10.0,
            actions=[
                OpaqueFunction(
                    function=lambda context: _nav2_bringup(
                        context,
                        nav2_bringup_dir,
                        map_yaml_file,
                        use_sim_time,
                        speed_params,
                    )
                ),
            ],
        ),
    ])
