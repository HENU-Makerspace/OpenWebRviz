#!/usr/bin/env python3
import hashlib

import rclpy
from nav_msgs.msg import OccupancyGrid
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy
from rclpy.qos import HistoryPolicy
from rclpy.qos import QoSProfile
from rclpy.qos import ReliabilityPolicy


class MapThrottle(Node):
    def __init__(self):
        super().__init__('map_throttle')

        self.declare_parameter('input_topic', '/map')
        self.declare_parameter('output_topic', '/map_web')
        self.declare_parameter('publish_on_metadata_change', True)

        input_topic = str(self.get_parameter('input_topic').value)
        output_topic = str(self.get_parameter('output_topic').value)
        publish_on_metadata_change = bool(self.get_parameter('publish_on_metadata_change').value)

        self.publish_on_metadata_change = publish_on_metadata_change
        self.last_digest = None

        qos = QoSProfile(
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )

        self.publisher = self.create_publisher(OccupancyGrid, output_topic, qos)
        self.subscription = self.create_subscription(
            OccupancyGrid,
            input_topic,
            self.handle_map,
            qos,
        )

        self.get_logger().info(
            f'Throttling {input_topic} -> {output_topic} (only publishes when map content changes)'
        )

    def build_digest(self, msg: OccupancyGrid):
        meta = (
            int(msg.info.width),
            int(msg.info.height),
            float(msg.info.resolution),
            float(msg.info.origin.position.x),
            float(msg.info.origin.position.y),
            float(msg.info.origin.position.z),
            float(msg.info.origin.orientation.x),
            float(msg.info.origin.orientation.y),
            float(msg.info.origin.orientation.z),
            float(msg.info.origin.orientation.w),
        )

        digest = hashlib.sha1()
        if self.publish_on_metadata_change:
            digest.update(repr(meta).encode('utf-8'))
        digest.update(bytes((value + 1) & 0xFF for value in msg.data))
        return digest.hexdigest()

    def handle_map(self, msg: OccupancyGrid):
        digest = self.build_digest(msg)
        if digest == self.last_digest:
            return

        self.last_digest = digest
        self.publisher.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = MapThrottle()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
