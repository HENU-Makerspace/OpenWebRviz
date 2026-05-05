#!/usr/bin/env bash
set -euo pipefail

patterns=(
  'mapping_all.launch.py'
  'nav_all.launch.py'
  'stand_nav_launch.py'
  'slam_toolbox'
  'async_slam_toolbox_node'
  'online_async'
  'fastlio_mapping'
  'livox_ros_driver2'
  'livox_ros_driver2_node'
  'pointcloud_to_laserscan'
  'pointcloud_to_laserscan_node'
  'base_footprint_projector'
  'cmd_vel_converter'
  'stand_cmd_vel_converter'
  'amcl'
  'map_server'
  'planner_server'
  'controller_server'
  'behavior_server'
  'smoother_server'
  'bt_navigator'
  'lifecycle_manager'
  'waypoint_follower'
  'velocity_smoother'
  'recoveries_server'
  'robot_state_publisher'
  'nav2_bringup'
  'navigation_launch'
  'gz sim'
)

for signal_name in TERM KILL; do
  for pattern in "${patterns[@]}"; do
    pkill "-${signal_name}" -f -- "${pattern}" 2>/dev/null || true
  done
  sleep 1
done
