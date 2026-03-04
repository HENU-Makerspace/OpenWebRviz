#!/bin/bash
# Navigation Simulation Launcher
# Usage: ./start_nav_sim.sh [robot_model]
# Example: ./start_nav_sim.sh turtlebot3_waffle

set -e

ROBOT_MODEL=${1:-turtlebot3_waffle}
ROS_DISTRO=${ROS_DISTRO:-humble}

echo "=========================================="
echo "  Navigation Simulation Launcher"
echo "  Robot: $ROBOT_MODEL"
echo "  ROS2 Distro: $ROS_DISTRO"
echo "=========================================="

# Check if rosbridge is running
if ! pgrep -f "rosbridge" > /dev/null; then
    echo "[1/4] Starting rosbridge_websocket..."
    ros2 run rosbridge_rosbridge websocket.py &
    sleep 2
else
    echo "[1/4] rosbridge already running"
fi

# Check if RViz2 is running
if ! pgrep -f "rviz2" > /dev/null; then
    echo "[2/4] Starting RViz2..."
    rviz2 -d $(ros2 pkg prefix navigation2_bringup)/share/navigation2_bringup/rviz/nav2_default_view.rviz &
    sleep 2
else
    echo "[2/4] RViz2 already running"
fi

# Start Gazebo with robot
if ! pgrep -f "gzserver" > /dev/null; then
    echo "[3/4] Starting Gazebo with $ROBOT_MODEL..."
    ros2 launch turtlebot3_gazebo turtlebot3_world.launch.py &
    sleep 5
else
    echo "[3/4] Gazebo already running"
fi

# Start navigation2
if ! pgrep -f "nav2_bringup" > /dev/null; then
    echo "[4/4] Starting Navigation2..."
    ros2 launch nav2_bringup navigation_launch.py use_sim_time:=true &
    sleep 3
else
    echo "[4/4] Navigation2 already running"
fi

echo ""
echo "=========================================="
echo "  All services started!"
echo "=========================================="
echo ""
echo "Open in browser: http://localhost:5173"
echo "Or run: bun run dev"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for interrupt
trap "echo 'Stopping services...'; pkill -f rosbridge; pkill -f rviz2; pkill -f gzserver; pkill -f nav2_bringup; pkill -f turtlebot3; exit 0" INT

wait
