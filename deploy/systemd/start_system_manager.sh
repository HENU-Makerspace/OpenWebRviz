#!/bin/bash
set -e

source /opt/ros/humble/setup.bash
source /home/nvidia/ros2_ws/install/setup.bash
export ROS_DOMAIN_ID=1
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp

exec ros2 launch jetson_node_pkg system_manager.launch.py
