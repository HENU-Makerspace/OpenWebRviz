#!/usr/bin/env python3
from collections import deque

import rclpy
from rclpy.duration import Duration
from rclpy.node import Node
from sensor_msgs.msg import LaserScan


class ScanThrottle(Node):
    def __init__(self):
        super().__init__('scan_throttle')

        self.declare_parameter('input_topic', '/scan_raw')
        self.declare_parameter('output_topic', '/scan')
        self.declare_parameter('output_rate_hz', 1.0)
        self.declare_parameter('queue_size', 5)

        input_topic = str(self.get_parameter('input_topic').value)
        output_topic = str(self.get_parameter('output_topic').value)
        output_rate_hz = max(float(self.get_parameter('output_rate_hz').value), 0.01)
        queue_size = max(int(self.get_parameter('queue_size').value), 1)

        self.buffer = deque(maxlen=queue_size)
        self.last_published_stamp = None
        self.publish_period = 1.0 / output_rate_hz

        self.publisher = self.create_publisher(LaserScan, output_topic, 10)
        self.subscription = self.create_subscription(
            LaserScan,
            input_topic,
            self.handle_scan,
            10,
        )
        self.timer = self.create_timer(self.publish_period, self.publish_latest)

        self.get_logger().info(
            f'Throttling {input_topic} -> {output_topic} at {output_rate_hz:.2f} Hz'
        )

    def handle_scan(self, msg: LaserScan):
        self.buffer.append(msg)

    def publish_latest(self):
        if not self.buffer:
            return

        msg = self.buffer[-1]
        current_stamp = Duration(seconds=msg.header.stamp.sec, nanoseconds=msg.header.stamp.nanosec)
        if self.last_published_stamp is not None and current_stamp <= self.last_published_stamp:
            return

        self.publisher.publish(msg)
        self.last_published_stamp = current_stamp


def main(args=None):
    rclpy.init(args=args)
    node = ScanThrottle()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
