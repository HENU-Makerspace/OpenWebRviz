#!/usr/bin/env python3
# Custom ros_gz_bridge that accepts both Twist and TwistStamped

import sys
from ros_gz_bridge.ros_gz_bridge import RosGzBridge

# Override the default bridge to accept Twist instead of TwistStamped
# This is a workaround for teleop_twist_keyboard

if __name__ == '__main__':
    bridge = RosGzBridge()
    bridge.accepts('Twist')  # Allow Twist, not just TwistStamped
    bridge.spin()
