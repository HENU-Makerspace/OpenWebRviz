import os
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription, TimerAction, DeclareLaunchArgument
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory

def generate_launch_description():
    # 声明参数变量
    use_sim_time = LaunchConfiguration('use_sim_time', default='false')

    # 获取各包的共享目录路径
    fast_lio_dir = get_package_share_directory('fast_lio')
    livox_driver_dir = get_package_share_directory('livox_ros_driver2')
    nav2_bringup_dir = get_package_share_directory('nav2_bringup')
    
    # 边建图边导航专用参数文件路径
    params_file = '/home/nvidia/ros2_ws/mapping_nav_params.yaml'

    return LaunchDescription([
        # 声明是否使用仿真时间
        DeclareLaunchArgument('use_sim_time', default_value='false'),

        # 1. 硬件层：启动 Livox MID360 驱动
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(livox_driver_dir, 'launch_ROS2', 'msg_MID360_launch.py')),
            launch_arguments={'use_sim_time': use_sim_time}.items(),
        ),

        # 2. SLAM层：启动 Fast-LIO 提供定位和 3D 里程计
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(fast_lio_dir, 'launch', 'mapping.launch.py')),
            launch_arguments={'rviz': 'false', 'use_sim_time': use_sim_time}.items(),
        ),

        # 3. 辅助层：修复 TF 坐标系 (补全 base_link 等)
        Node(
            package='jetson_node_pkg',
            executable='continuous_tf_pub',
            name='continuous_tf_pub',
            output='screen'
        ),

        # 4. 辅助层：将 3D 点云切片成 2D 激光雷达数据 (供代价地图避障使用)
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

        # 5. 通讯层：启动 MQTT 桥接器
        Node(
            package='mqtt_client',
            executable='mqtt_client',
            name='mqtt_client',
            output='screen',
            parameters=['/home/nvidia/ros2_ws/src/mqtt_client/mqtt_client/config/params.yaml']
        ),

        # 6. 动作层：启动 cmd_vel 转换器（确保机器人姿态动作正确，比如先趴下）
        Node(
            package='jetson_node_pkg',
            executable='cmd_vel_converter',
            name='cmd_vel_converter',
            output='screen'
        ),

        # 7. 导航层：延迟 10 秒启动纯净版导航栈 (切除 AMCL 和 MapServer)
        TimerAction(
            period=10.0,
            actions=[
                IncludeLaunchDescription(
                    PythonLaunchDescriptionSource(os.path.join(nav2_bringup_dir, 'launch', 'navigation_launch.py')),
                    launch_arguments={
                        'params_file': params_file,
                        'use_sim_time': use_sim_time
                    }.items()
                )
            ]
        )
    ])