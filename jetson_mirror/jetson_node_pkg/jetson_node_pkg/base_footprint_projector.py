#!/usr/bin/env python3
import math

import rclpy
from geometry_msgs.msg import TransformStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from tf2_ros import TransformBroadcaster


def yaw_from_quaternion(q):
    siny_cosp = 2.0 * (q.w * q.z + q.x * q.y)
    cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
    return math.atan2(siny_cosp, cosy_cosp)


def yaw_from_quaternion_tuple(q):
    siny_cosp = 2.0 * (q[3] * q[2] + q[0] * q[1])
    cosy_cosp = 1.0 - 2.0 * (q[1] * q[1] + q[2] * q[2])
    return math.atan2(siny_cosp, cosy_cosp)


def quaternion_multiply(a, b):
    return (
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    )


def quaternion_inverse(q):
    norm = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]
    return (-q[0] / norm, -q[1] / norm, -q[2] / norm, q[3] / norm)


def normalize_quaternion(q):
    norm = math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
    if norm == 0.0:
        return (0.0, 0.0, 0.0, 1.0)
    return (q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm)


def yaw_quaternion(yaw):
    return (0.0, 0.0, math.sin(yaw / 2.0), math.cos(yaw / 2.0))


def rotate_vector(q, v):
    qv = (v[0], v[1], v[2], 0.0)
    rotated = quaternion_multiply(quaternion_multiply(q, qv), quaternion_inverse(q))
    return rotated[:3]


class BaseFootprintProjector(Node):
    def __init__(self):
        super().__init__('base_footprint_projector')

        self.declare_parameter('odom_topic', '/Odometry')
        self.declare_parameter('odom_frame', 'camera_init')
        self.declare_parameter('base_footprint_frame', 'base_footprint')
        self.declare_parameter('base_link_frame', 'base_link')
        self.declare_parameter('body_to_base_x', 0.05)
        self.declare_parameter('body_to_base_y', 0.0)
        self.declare_parameter('base_link_z', -0.25)

        self.odom_frame = self.get_parameter('odom_frame').value
        self.base_footprint_frame = self.get_parameter('base_footprint_frame').value
        self.base_link_frame = self.get_parameter('base_link_frame').value
        self.body_to_base_x = self.get_parameter('body_to_base_x').value
        self.body_to_base_y = self.get_parameter('body_to_base_y').value
        self.base_link_z = self.get_parameter('base_link_z').value
        odom_topic = self.get_parameter('odom_topic').value

        self.broadcaster = TransformBroadcaster(self)
        self.subscription = self.create_subscription(Odometry, odom_topic, self.handle_odom, 20)

        self.get_logger().info(
            f'Publishing planar TF {self.odom_frame} -> {self.base_footprint_frame} '
            f'and tilted TF {self.base_footprint_frame} -> {self.base_link_frame} '
            f'from {odom_topic} with body->base_link offset '
            f'({self.body_to_base_x}, {self.body_to_base_y}, {self.base_link_z})'
        )

    def handle_odom(self, msg):
        frame = self.odom_frame or msg.header.frame_id
        pose = msg.pose.pose
        body_q = normalize_quaternion((
            pose.orientation.x,
            pose.orientation.y,
            pose.orientation.z,
            pose.orientation.w,
        ))
        body_to_base_q = (0.0, 0.0, 1.0, 0.0)
        base_q = normalize_quaternion(quaternion_multiply(body_q, body_to_base_q))
        base_yaw = yaw_from_quaternion_tuple(base_q)
        footprint_q = yaw_quaternion(base_yaw)

        base_offset = rotate_vector(
            body_q,
            (self.body_to_base_x, self.body_to_base_y, self.base_link_z),
        )
        base_x = pose.position.x + base_offset[0]
        base_y = pose.position.y + base_offset[1]
        base_z = pose.position.z + base_offset[2]
        relative_q = normalize_quaternion(
            quaternion_multiply(quaternion_inverse(footprint_q), base_q)
        )

        footprint = TransformStamped()
        footprint.header.stamp = msg.header.stamp
        footprint.header.frame_id = frame
        footprint.child_frame_id = self.base_footprint_frame
        footprint.transform.translation.x = base_x
        footprint.transform.translation.y = base_y
        footprint.transform.translation.z = 0.0
        footprint.transform.rotation.x = 0.0
        footprint.transform.rotation.y = 0.0
        footprint.transform.rotation.z = footprint_q[2]
        footprint.transform.rotation.w = footprint_q[3]

        base_link = TransformStamped()
        base_link.header.stamp = msg.header.stamp
        base_link.header.frame_id = self.base_footprint_frame
        base_link.child_frame_id = self.base_link_frame
        base_link.transform.translation.x = 0.0
        base_link.transform.translation.y = 0.0
        base_link.transform.translation.z = base_z
        base_link.transform.rotation.x = relative_q[0]
        base_link.transform.rotation.y = relative_q[1]
        base_link.transform.rotation.z = relative_q[2]
        base_link.transform.rotation.w = relative_q[3]

        self.broadcaster.sendTransform([footprint, base_link])


def main(args=None):
    rclpy.init(args=args)
    node = BaseFootprintProjector()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()
