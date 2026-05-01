#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from std_msgs.msg import Bool
from motion_msgs.msg import MotionCtrl

class StandCmdVelConverter(Node):
    def __init__(self):
        super().__init__('stand_cmd_vel_converter')

        self.sub_vel = self.create_subscription(Twist, '/cmd_vel', self.cmd_callback, 10)
        self.sub_stand = self.create_subscription(Bool, '/stand_cmd', self.stand_callback, 10)
        self.pub = self.create_publisher(MotionCtrl, '/diablo/MotionCmd', 10)

        # 核心参数
        self.target_up = 1.0  # 安全站立高度
        self.current_forward = 0.0
        self.current_left = 0.0

        # 状态机变量
        self.is_standing = True       # 默认目标是站立
        self.transition_ticks = 15    # 启动时先给 15 帧 (0.6秒) 的变形信号，确保底盘能收到

        self.get_logger().info("站立控制节点已启动！正在发送站立序列...")

        # 统一使用 25Hz 定时器接管所有发送
        self.timer = self.create_timer(0.04, self.timer_callback)

    def cmd_callback(self, msg: Twist):
        self.current_forward = float(msg.linear.x)
        self.current_left = float(msg.angular.z)

    def stand_callback(self, msg: Bool):
        # 如果收到新的姿态命令，并且和当前不一样
        if msg.data != self.is_standing:
            self.is_standing = msg.data
            # 给定 10 帧 (10 * 0.04 = 0.4秒) 的"按键时间"
            self.transition_ticks = 10
            state_str = "站立" if self.is_standing else "趴下"
            self.get_logger().info(f"收到指令：开始执行 {state_str} 序列...")

    def timer_callback(self):
        # ==========================================
        # 统一的发送逻辑：依靠时间帧来确保硬件收到指令
        # ==========================================

        if self.transition_ticks > 0:
            # 【过渡期】：连续发送 mode_mark=True
            # 变形期间，高度设置为目标高度（不发送0.0！）
            current_up = self.target_up if self.is_standing else 0.0
            self.publish_state(mode_mark=True, stand_mode=self.is_standing, up=current_up)
            self.transition_ticks -= 1

            if self.transition_ticks == 0:
                state_str = "站立" if self.is_standing else "趴下"
                self.get_logger().info(f"{state_str} 变形信号发送完毕，进入高度锁定！")
        else:
            # 【稳定期】：松开按键 (mode_mark=False)，维持当前设定
            # 如果是站立，推到 target_up；如果是趴下，就是 0.0
            current_up = self.target_up if self.is_standing else 0.0
            self.publish_state(mode_mark=False, stand_mode=self.is_standing, up=current_up)

    def publish_state(self, mode_mark, stand_mode, up):
        msg = MotionCtrl()
        msg.mode_mark = mode_mark
        msg.mode.stand_mode = stand_mode
        msg.mode.pitch_ctrl_mode = False
        msg.mode.roll_ctrl_mode = False
        msg.mode.height_ctrl_mode = True   # 【关键】开启高度闭环
        msg.mode.jump_mode = False
        msg.mode.split_mode = False
        msg.value.forward = self.current_forward
        msg.value.left = self.current_left
        msg.value.up = up
        msg.value.roll = 0.0
        msg.value.pitch = 0.0
        msg.value.leg_split = 0.0
        self.pub.publish(msg)

def main(args=None):
    rclpy.init(args=args)
    node = StandCmdVelConverter()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()