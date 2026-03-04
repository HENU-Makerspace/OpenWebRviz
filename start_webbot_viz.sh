#!/bin/bash

# WebBot-Viz Startup Script
# This script starts ROS 2 simulation, rosbridge_websocket, and SLAM for WebBot-Viz

# Source ROS 2
source /opt/ros/jazzy/setup.bash

echo "=== Starting TurtleBot3 Gazebo Simulation ==="
# Terminal 1: Start Gazebo simulation with TurtleBot3
export TURTLEBOT3_MODEL=burger
ros2 launch turtlebot3_gazebo turtlebot3_world.launch.py &

# Wait for Gazebo to start
sleep 15

echo "=== Starting rosbridge_websocket ==="
# Terminal 2: Start rosbridge WebSocket server
ros2 launch rosbridge_server rosbridge_websocket_launch.xml &

sleep 3

echo "=== Starting SLAM Toolbox ==="
# Terminal 3: Start SLAM for map generation
ros2 launch slam_toolbox online_async_launch.py &

sleep 3

echo "=== Available ROS Topics ==="
ros2 topic list | grep -E "map|scan|tf|odom"

echo ""
echo "=== Setup Complete ==="
echo "Open http://localhost:3000 in your browser"
echo ""
echo "=== To control the robot, use ONE of the following methods: ==="
echo ""
echo "Method 1 - Direct topic publish (works):"
echo '  ros2 topic pub /cmd_vel geometry_msgs/msg/TwistStamped "{header: {stamp: {sec: 0, nanosec: 0}, frame_id: \"\"}, twist: {linear: {x: 0.1, y: 0.0, z: 0.0}, angular: {x: 0.0, y: 0.0, z: 0.0}}}" -r 10'
echo ""
echo "Method 2 - Use twist_stamped_publisher:"
echo '  ros2 run twist_stamped_publisher twist_stamped_publisher'
echo ""
echo "Method 3 - Modify bridge config to accept Twist (not recommended)"
echo ""
echo "Note: The ros_gz_bridge expects TwistStamped, but teleop_twist_keyboard publishes Twist!"
