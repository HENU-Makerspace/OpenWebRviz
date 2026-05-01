#!/usr/bin/env python3
"""
让机器人趴下的测试脚本
"""
import rclpy
from rclpy.node import Node
from std_msgs.msg import Bool

class SitDownTest(Node):
    def __init__(self):
        super().__init__('sit_down_test')
        self.pub = self.create_publisher(Bool, '/stand_cmd', 10)
        self.get_logger().info('发送趴下指令...')

        msg = Bool()
        msg.data = False  # False = 趴下
        self.pub.publish(msg)
        self.get_logger().info('已发送趴下命令!')

def main(args=None):
    rclpy.init(args=args)
    node = SitDownTest()
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()
