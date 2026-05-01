from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    return LaunchDescription([
        Node(
            package='tf2_ros',
            executable='static_transform_publisher',
            name='tf_lidar_to_camera',
            arguments=['0.1', '0', '-0.12', '0', '0', '0', 'lidar_link', 'camera_link']
        ),
        Node(
            package='pointcloud_to_laserscan',
            executable='pointcloud_to_laserscan_node',
            name='pointcloud_to_laserscan',
            remappings=[('cloud_in', '/cloud_registered'), ('scan', '/scan')],
            parameters=[{
                'target_frame': 'base_link', 
                'transform_tolerance': 0.01,
                'min_height': -0.5,
                'max_height': 0.5,
                'angle_min': -3.1415,
                'angle_max': 3.1415,
                'angle_increment': 0.01,
                'scan_time': 0.1,
                'range_min': 0.2,
                'range_max': 20.0,
                'use_inf': True,
                'qos_reliability': 'reliable' 
            }]
        )
    ])
