#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from tf2_ros import TransformBroadcaster
from geometry_msgs.msg import TransformStamped

class StandContinuousTF(Node):
    def __init__(self):
        super().__init__('stand_continuous_tf_pub')
        self.broadcaster = TransformBroadcaster(self)
        # 提高到 20Hz 发布，防止TF丢失
        self.timer = self.create_timer(0.05, self.publish_all_tfs)
        self.get_logger().info("站立模式 TF 启动！雷达高度已抬升。")

    def publish_all_tfs(self):
        now = self.get_clock().now().to_msg()

        # 1. 雷达 body -> 车身 base_link
        # 站立时雷达抬高，z = -0.35 (比趴着时的 -0.25 高10cm)
        t1 = TransformStamped()
        t1.header.stamp = now
        t1.header.frame_id = 'body'
        t1.child_frame_id = 'base_link'

        t1.transform.translation.x = 0.05
        t1.transform.translation.y = 0.0
        t1.transform.translation.z = -0.35

        # 偏航角转180度
        t1.transform.rotation.x = 0.0
        t1.transform.rotation.y = 0.0
        t1.transform.rotation.z = 1.0
        t1.transform.rotation.w = 0.0

        self.broadcaster.sendTransform(t1)

        # 2. 车身 base_link -> 相机 camera_link
        # 站立时相机也抬高
        t2 = TransformStamped()
        t2.header.stamp = now
        t2.header.frame_id = 'base_link'
        t2.child_frame_id = 'camera_link'

        t2.transform.translation.x = 0.15
        t2.transform.translation.y = 0.0
        t2.transform.translation.z = 0.25

        t2.transform.rotation.x = 0.0
        t2.transform.rotation.y = 0.0
        t2.transform.rotation.z = 0.0
        t2.transform.rotation.w = 1.0

        self.broadcaster.sendTransform(t2)

def main(args=None):
    rclpy.init(args=args)
    node = StandContinuousTF()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()