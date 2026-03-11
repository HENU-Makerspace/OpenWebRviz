from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    slam_package_arg = DeclareLaunchArgument(
        'slam_package',
        default_value='jetson_node_pkg',
        description='SLAM launch package name'
    )

    slam_launch_file_arg = DeclareLaunchArgument(
        'slam_launch_file',
        default_value='mapping_all.launch.py',
        description='SLAM launch file name'
    )

    nav_package_arg = DeclareLaunchArgument(
        'nav_package',
        default_value='jetson_node_pkg',
        description='Navigation launch package name'
    )

    nav_launch_file_arg = DeclareLaunchArgument(
        'nav_launch_file',
        default_value='nav_all.launch.py',
        description='Navigation launch file name'
    )

    maps_dir_arg = DeclareLaunchArgument(
        'maps_dir',
        default_value='/home/nvidia/maps',
        description='Directory to save maps'
    )

    system_manager_node = Node(
        package='jetson_node_pkg',
        executable='system_manager_node',
        name='system_manager_node',
        parameters=[{
            'slam_package': LaunchConfiguration('slam_package'),
            'slam_launch_file': LaunchConfiguration('slam_launch_file'),
            'nav_package': LaunchConfiguration('nav_package'),
            'nav_launch_file': LaunchConfiguration('nav_launch_file'),
            'maps_dir': LaunchConfiguration('maps_dir'),
        }],
        output='screen',
    )

    return LaunchDescription([
        slam_package_arg,
        slam_launch_file_arg,
        nav_package_arg,
        nav_launch_file_arg,
        maps_dir_arg,
        system_manager_node,
    ])