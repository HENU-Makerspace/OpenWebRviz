#!/usr/bin/env python3
"""
机器人停止保护节点
功能：当导航结束时（cmd_vel没有新数据），自动发送停止命令让机器人停下
"""
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from motion_msgs.msg import MotionCtrl

class StopGuard(Node):
    def __init__(self):
        super().__init__('stop_guard')

        # 订阅 cmd_vel 话题
        self.sub_vel = self.create_subscription(Twist, '/cmd_vel', self.cmd_callback, 10)

        # 发布给底盘的停止命令
        self.pub = self.create_publisher(MotionCtrl, '/diablo/MotionCmd', 10)

        # 上一次收到cmd_vel的时间
        self.last_cmd_time = self.get_clock().now()

        # 超时时间（秒），超过这个时间没收到cmd_vel就认为是导航结束
        self.timeout = 1.0

        # 创建定时器检查超时
        self.timer = self.create_timer(0.1, self.check_timeout)

        self.get_logger().info('停止保护节点已启动！')

    def cmd_callback(self, msg: Twist):
        # 收到新的cmd_vel，更新时间
        self.last_cmd_time = self.get_clock().now()

    def check_timeout(self):
        # 检查是否超时
        now = self.get_clock().now()
        elapsed = (now - self.last_cmd_time).nanoseconds / 1e9

        if elapsed > self.timeout:
            # 超时了，发送停止命令
            self.publish_stop()

    def publish_stop(self):
        msg = MotionCtrl()
        msg.mode_mark = False
        msg.mode.stand_mode = True  # 保持站立状态
        msg.mode.pitch_ctrl_mode = False
        msg.mode.roll_ctrl_mode = False
        msg.mode.height_ctrl_mode = True  # 保持高度控制
        msg.mode.jump_mode = False
        msg.mode.split_mode = False

        # 所有速度设为0
        msg.value.forward = 0.0
        msg.value.left = 0.0
        msg.value.up = 1.0  # 保持站立高度
        msg.value.roll = 0.0
        msg.value.pitch = 0.0
        msg.value.leg_split = 0.0

        self.pub.publish(msg)

def main(args=None):
    rclpy.init(args=args)
    node = StopGuard()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()
