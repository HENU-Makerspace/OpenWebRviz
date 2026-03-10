#!/bin/bash

# Cleanup function to kill all child processes
cleanup() {
    echo "Stopping navigation..."
    pkill -f nav2_bringup 2>/dev/null
    pkill -f navigation_launch 2>/dev/null
    pkill -f robot_state_publisher 2>/dev/null
    pkill -f turtlebot3_gazebo 2>/dev/null
    pkill -f "gz sim" 2>/dev/null
    exit 0
}

trap cleanup SIGHUP SIGTERM EXIT

source /opt/ros/jazzy/setup.bash
export TURTLEBOT3_MODEL=burger

MAP_YAML_PATH="/home/c6h4o2/dev/web/ROS/packages/server/maps/map_1772633245742.yaml"
echo "Starting navigation with map: /home/c6h4o2/dev/web/ROS/packages/server/maps/map_1772633245742.yaml"

# Get robot description from turtlebot3 description (plain URDF, not xacro)
TURTLEBOT3_URDF=$(ros2 pkg prefix turtlebot3_description)/share/turtlebot3_description/urdf/turtlebot3_burger.urdf
export ROBOT_DESCRIPTION=$(cat $TURTLEBOT3_URDF)

# Start Gazebo if not running
if ! pgrep -f "gz sim" > /dev/null; then
  echo "Starting Gazebo..."
  ros2 launch turtlebot3_gazebo turtlebot3_world.launch.py &
  sleep 10
fi

# Start robot state publisher with robot description
ros2 run robot_state_publisher robot_state_publisher --ros-args -p robot_description:="$ROBOT_DESCRIPTION" &

sleep 2

# Start navigation2 with map (bringup includes localization + navigation)
echo "Starting Navigation2 with map $MAP_YAML_PATH..."
ros2 launch nav2_bringup bringup_launch.py use_sim_time:=true map:=$MAP_YAML_PATH &

echo "Navigation started. Kill TMUX session to stop."
wait
