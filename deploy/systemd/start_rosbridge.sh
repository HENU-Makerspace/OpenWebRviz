#!/bin/bash
set -e

source /opt/ros/humble/setup.bash
source /home/nvidia/ros2_ws/install/setup.bash
export ROS_DOMAIN_ID=1
export RMW_IMPLEMENTATION=rmw_fastrtps_cpp

exec ros2 launch rosbridge_server rosbridge_websocket_launch.xml \
  port:=9090 \
  address:=0.0.0.0 \
  call_services_in_new_thread:=true \
  send_action_goals_in_new_thread:=true \
  default_call_service_timeout:=5.0
