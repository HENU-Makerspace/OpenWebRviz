#!/usr/bin/env python3
"""
单独让机器人站起来的测试脚本
使用方法: ros2 run jetson_node_pkg stand_test
"""
import rclpy
from rclpy.node import Node
from std_msgs.msg import Bool

class StandTest(Node):
    def __init__(self):
        super().__init__('stand_test')
        self.pub = self.create_publisher(Bool, '/stand_cmd', 10)
        self.get_logger().info('发送站立指令...')

        # 发送站立命令
        msg = Bool()
        msg.data = True  # True = 站立, False = 趴下
        self.pub.publish(msg)
        self.get_logger().info('已发送站立命令!')

def main(args=None):
    rclpy.init(args=args)
    node = StandTest()
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()
