import os
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription, DeclareLaunchArgument, TimerAction
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory

def generate_launch_description():
    fast_lio_dir = get_package_share_directory('fast_lio')
    livox_driver_dir = get_package_share_directory('livox_ros_driver2')
    nav2_bringup_dir = get_package_share_directory('nav2_bringup')

    # 趴着导航用的配置文件
    map_yaml_file = '/home/nvidia/ros2_ws/my_map.yaml'
    nav2_params_file = '/home/nvidia/ros2_ws/my_nav2_params.yaml'
    use_sim_time = LaunchConfiguration('use_sim_time', default='false')

    return LaunchDescription([
        DeclareLaunchArgument('use_sim_time', default_value='false'),

        # 0. 启动雷达
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(livox_driver_dir, 'launch_ROS2', 'msg_MID360_launch.py')),
            launch_arguments={'use_sim_time': use_sim_time}.items(),
        ),

        # 1. 启动 Fast-LIO
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(fast_lio_dir, 'launch', 'mapping.launch.py')),
            launch_arguments={'rviz': 'false', 'use_sim_time': use_sim_time}.items(),
        ),

        # 2. 启动趴着专用的 TF 节点
        Node(
            package='jetson_node_pkg',
            executable='continuous_tf_pub',
            name='continuous_tf_pub',
            output='screen'
        ),

        # 3. 启动点云切片
        Node(
            package='pointcloud_to_laserscan',
            executable='pointcloud_to_laserscan_node',
            name='pointcloud_to_laserscan',
            remappings=[('cloud_in', '/cloud_registered_body'), ('scan', '/scan')],
            parameters=[{
                'target_frame': 'base_link',
                'transform_tolerance': 0.05,
                'min_height': -0.05,
                'max_height': 2.0,
                'angle_min': -3.14159,
                'angle_max': 3.14159,
                'angle_increment': 0.0087,
                'scan_time': 0.1,
                'range_min': 0.3,
                'range_max': 20.0,
                'use_inf': True,
                'use_sim_time': use_sim_time
            }]
        ),

        # 4. 先启动控制桥接器（让机器人趴下来）
        Node(
            package='jetson_node_pkg',
            executable='cmd_vel_converter',
            name='cmd_vel_converter',
            output='screen'
        ),

        # 5. 等待2秒让机器人完全趴下，然后启动 Nav2
        TimerAction(
            period=2.0,
            actions=[
                IncludeLaunchDescription(
                    PythonLaunchDescriptionSource(os.path.join(nav2_bringup_dir, 'launch', 'bringup_launch.py')),
                    launch_arguments={
                        'map': map_yaml_file,
                        'params_file': nav2_params_file,
                        'use_sim_time': use_sim_time
                    }.items()
                ),
            ]
        ),

        # 6. 启动 MQTT
        Node(
            package='mqtt_client',
            executable='mqtt_client',
            name='mqtt_client',
            output='screen',
            parameters=['/home/nvidia/ros2_ws/src/mqtt_client/mqtt_client/config/params.yaml']
        )
    ])
