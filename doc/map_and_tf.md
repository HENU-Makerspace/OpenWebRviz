# Map & TF Rendering

## Overview

This feature renders the OccupancyGrid map from the `/map` topic and displays the robot's position using TF transforms.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      MapCanvas Component                      │
├─────────────────────────────────────────────────────────────┤
│  useRosMap()                                                │
│  └── Subscribes to: /map (nav_msgs/msg/OccupancyGrid)     │
│  └── Parses: width, height, resolution, origin, data      │
├─────────────────────────────────────────────────────────────┤
│  useRosTf()                                                 │
│  └── TFClient for map → base_link transform                │
│  └── Extracts: x, y, theta from quaternion                │
├─────────────────────────────────────────────────────────────┤
│  Canvas Rendering Loop                                      │
│  └── Draws grid cells (white/gray/black)                  │
│  └── Draws robot pose (green circle + arrow)              │
│  └── Handles pan/zoom interaction                         │
└─────────────────────────────────────────────────────────────┘
```

## Components

### useRosMap Hook

Subscribes to `/map` topic and provides map data.

**Returns:**
- `mapData`: OccupancyGrid message with metadata
- `isMapLoaded`: Boolean indicating map data received
- `error`: Error message if subscription fails

**Message Format:**
```typescript
interface MapData {
  header: {
    stamp: { sec: number; nsec: number };
    frame_id: string;
  };
  info: {
    resolution: number;  // meters per cell
    width: number;       // cells
    height: number;      // cells
    origin: {
      position: { x: number; y: number; z: number };
      orientation: { x: number; y: number; z: number; w: number };
    };
  };
  data: number[];  // row-major, 0-100, -1 unknown
}
```

### useRosTf Hook

Uses `ROSLIB.TFClient` to get transforms between frames.

**Parameters:**
- `targetFrame`: Fixed frame (default: 'map')
- `sourceFrame`: Frame to track (default: 'base_link')

**Returns:** RobotPose
```typescript
interface RobotPose {
  x: number;
  y: number;
  theta: number;  // yaw in radians
  frameId: string;
}
```

### MapCanvas Component

Renders map and robot on HTML5 Canvas.

**Features:**
- Auto-resizes to container
- Pan (drag) and zoom (scroll wheel)
- 60fps render loop
- Legend overlay
- Map info overlay (resolution, size, scale)

## Rendering Details

### Cell Coloring

| Value | Color | Meaning |
|-------|-------|---------|
| 0 | White (#f0f0f0) | Free space |
| 100 | Dark (#1e1e1e) | Occupied |
| -1 | Gray (#b0b0b0) | Unknown |

### Coordinate Transformation

```
Map coordinates (meters)
    ↓ (scale: px/meter)
Canvas coordinates (pixels)
```

The Y-axis is flipped (ROS uses right-handed, canvas Y increases downward).

### Grid Lines

Drawn at 1-meter intervals when zoom scale >= 10 px/meter.

## Usage

```tsx
<MapCanvas
  ros={ros}
  isConnected={isConnected}
  mapTopic="/map"  // optional, default: '/map'
/>
```

## TF Frame Hierarchy

```
map (fixed frame)
  ↓
odom → base_link (robot frame)
```

The robot pose is obtained by looking up the transform from `map` to `base_link`.

## Performance Considerations

- Uses `requestAnimationFrame` for 60fps rendering
- Optimized cell rendering with batch drawing
- Grid lines only drawn at appropriate zoom levels

## Files

- [hooks/useRosMap.ts](../packages/client/src/hooks/useRosMap.ts) - Map subscription hook
- [hooks/useRosTf.ts](../packages/client/src/hooks/useRosTf.ts) - TF transform hook
- [components/MapCanvas.tsx](../packages/client/src/components/MapCanvas.tsx) - Main canvas component

## Troubleshooting

### Map not showing
- Check `/map` topic is being published: `ros2 topic list | grep /map`
- Verify compression is handled (we use `compression: 'png'`)

### Robot pose not appearing
- Check TF tree: `ros2 run tf2_ros view_frames`
- Verify `base_link` frame exists
- Check `/tf` topic is publishing

### Map appears upside down
- Y-axis flip is intentional for ROS coordinate system
- The origin marker shows where (0,0) is located
