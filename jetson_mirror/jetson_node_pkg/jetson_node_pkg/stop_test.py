#!/usr/bin/env python3
"""
让机器人停止运动的测试脚本
"""
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist

class StopTest(Node):
    def __init__(self):
        super().__init__('stop_test')
        self.pub = self.create_publisher(Twist, '/cmd_vel', 10)
        self.get_logger().info('发送停止命令...')

        # 发送停止命令（速度为0）
        msg = Twist()
        msg.linear.x = 0.0
        msg.linear.y = 0.0
        msg.linear.z = 0.0
        msg.angular.x = 0.0
        msg.angular.y = 0.0
        msg.angular.z = 0.0
        self.pub.publish(msg)
        self.get_logger().info('已发送停止命令!')

def main(args=None):
    rclpy.init(args=args)
    node = StopTest()
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()
