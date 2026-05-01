#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from tf2_ros import TransformBroadcaster
from geometry_msgs.msg import TransformStamped

class ContinuousTF(Node):
    def __init__(self):
        super().__init__('continuous_tf_pub')
        
        self.broadcaster = TransformBroadcaster(self)
        # 保持 50Hz 高频发布，防止旋转漂移！
        self.timer = self.create_timer(0.1, self.publish_all_tfs) # 稍微提速到50Hz (0.02s)
        self.get_logger().info("成功启动！S正在以 50Hz 持续发布最新的精确 TF...")

    def publish_all_tfs(self):
        now = self.get_clock().now().to_msg()
        
        # ==========================================
        # 1. 雷达 body -> 车身 base_link
        # ==========================================
        t1 = TransformStamped()
        t1.header.stamp = now
        t1.header.frame_id = 'body'
        t1.child_frame_id = 'base_link'
        
        # 雷达在车前5cm(真实世界)，转了180度后，base_link在雷达坐标系的+X方向5cm处
        t1.transform.translation.x = 0.05  # <--- 【精准修正】向车头偏移 5cm
        t1.transform.translation.y = 0.0
        t1.transform.translation.z = -0.25 # 雷达在顶上，base_link在下面 25cm
        
        # 偏航角(Yaw)转 180 度 (雷达背朝前安装)
        t1.transform.rotation.x = 0.0
        t1.transform.rotation.y = 0.0
        t1.transform.rotation.z = 1.0  
        t1.transform.rotation.w = 0.0  
        
        self.broadcaster.sendTransform(t1)
        
        # ==========================================
        # 2. 车身 base_link -> 相机 camera_link
        # ==========================================
        t2 = TransformStamped()
        t2.header.stamp = now
        t2.header.frame_id = 'base_link'
        t2.child_frame_id = 'camera_link'
        
        # 相机在车体中心前15cm(刚好是雷达前10cm)，高15cm(刚好是雷达下10cm)
        t2.transform.translation.x = 0.15   # 完美！
        t2.transform.translation.y = 0.0    
        t2.transform.translation.z = 0.15   # 完美！
        
        # 相机朝向正前方，不旋转
        t2.transform.rotation.x = 0.0
        t2.transform.rotation.y = 0.0
        t2.transform.rotation.z = 0.0
        t2.transform.rotation.w = 1.0
        
        self.broadcaster.sendTransform(t2)

def main(args=None):
    rclpy.init(args=args)
    node = ContinuousTF()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()

if __name__ == '__main__':
    main()