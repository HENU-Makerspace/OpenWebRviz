import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    fast_lio_dir = get_package_share_directory('fast_lio')
    livox_driver_dir = get_package_share_directory('livox_ros_driver2')
    use_sim_time = LaunchConfiguration('use_sim_time', default='false')
    slam_params_file = LaunchConfiguration('slam_params_file', default='/home/nvidia/ros2_ws/my_slam.yaml')
    pointcloud_target_frame = LaunchConfiguration('pointcloud_target_frame', default='base_footprint')

    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false'),
        DeclareLaunchArgument('slam_params_file', default_value='/home/nvidia/ros2_ws/my_slam.yaml'),
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
                'transform_tolerance': 0.05,
                'min_height': -0.1,
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
            package='slam_toolbox',
            executable='async_slam_toolbox_node',
            name='slam_toolbox',
            output='screen',
            parameters=[
                slam_params_file,
                {'use_sim_time': use_sim_time},
            ],
        ),
    ])
