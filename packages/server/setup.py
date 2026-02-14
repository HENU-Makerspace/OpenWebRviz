from setuptools import setup
import os

setup(
    name='webbot_viz',
    version='0.1.0',
    packages=['webbot_viz'],
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/webbot_viz']),
        ('share/webbot_viz', ['package.xml']),
        ('share/webbot_viz/launch', ['launch/rosbridge_websocket_launch.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='Developer',
    author='Developer',
    description='WebBot-Viz ROS 2 package',
    license='MIT',
)
