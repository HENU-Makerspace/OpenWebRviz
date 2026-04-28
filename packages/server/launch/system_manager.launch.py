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
        description='Navigation launch file name (crouch mode)'
    )

    stand_nav_launch_file_arg = DeclareLaunchArgument(
        'stand_nav_launch_file',
        default_value='stand_nav_launch.py',
        description='Stand navigation launch file name'
    )

    maps_dir_arg = DeclareLaunchArgument(
        'maps_dir',
        default_value='/home/nvidia/maps',
        description='Directory to save maps'
    )

    server_url_arg = DeclareLaunchArgument(
        'server_url',
        default_value='http://182.43.86.126:4001',
        description='Server URL for map upload'
    )

    nav2_params_file_arg = DeclareLaunchArgument(
        'nav2_params_file',
        default_value='',
        description='Optional Nav2 params override. Leave empty to let the navigation launch select params by speed.'
    )

    cmd_vel_timeout_arg = DeclareLaunchArgument(
        'cmd_vel_timeout_sec',
        default_value='0.5',
        description='Publish zero velocity if navigation stops publishing cmd_vel for this many seconds'
    )

    cmd_vel_stop_period_arg = DeclareLaunchArgument(
        'cmd_vel_stop_period_sec',
        default_value='0.2',
        description='Minimum interval between watchdog stop commands'
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
            'stand_nav_launch_file': LaunchConfiguration('stand_nav_launch_file'),
            'maps_dir': LaunchConfiguration('maps_dir'),
            'server_url': LaunchConfiguration('server_url'),
            'nav2_params_file': LaunchConfiguration('nav2_params_file'),
            'cmd_vel_timeout_sec': LaunchConfiguration('cmd_vel_timeout_sec'),
            'cmd_vel_stop_period_sec': LaunchConfiguration('cmd_vel_stop_period_sec'),
        }],
        output='screen',
    )

    return LaunchDescription([
        slam_package_arg,
        slam_launch_file_arg,
        nav_package_arg,
        nav_launch_file_arg,
        stand_nav_launch_file_arg,
        maps_dir_arg,
        server_url_arg,
        nav2_params_file_arg,
        cmd_vel_timeout_arg,
        cmd_vel_stop_period_arg,
        system_manager_node,
    ])
