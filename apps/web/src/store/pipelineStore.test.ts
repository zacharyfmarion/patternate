import { polygonToSpline } from '../edit/splinePath';
import type { RectifyResult } from '../engine/types';
import { usePipelineStore } from './pipelineStore';

function makeResult(): RectifyResult {
  return {
    detection: {
      summary: {
        board_id: 'refboard_v1',
        marker_count: 8,
        charuco_corner_count: 24,
        confidence: 0.99,
        board_outline_image: null,
        board_reprojection_rmse_px: 0.5,
      },
      homography_board_mm_to_image: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      markers: [],
      charuco_corners: [],
    },
    quality: {
      schema_version: 1,
      status: 'ok',
      warnings: [],
      metrics: {
        blur_score: 1,
        exposure_score: 1,
        board_coverage: 1,
        board_confidence: 1,
        board_reprojection_rmse_px: 0.5,
      },
    },
    metadata: {
      schema_version: 1,
      phase: 'finalize_results',
      input_image: { width_px: 100, height_px: 100 },
      prepared_image: { width_px: 100, height_px: 100 },
      reference_board: {
        board_id: 'refboard_v1',
        squares_x: 11,
        squares_y: 8,
        square_size_mm: 15,
        marker_size_mm: 11,
      },
      board_detection: {
        board_id: 'refboard_v1',
        marker_count: 8,
        charuco_corner_count: 24,
        confidence: 0.99,
        board_outline_image: null,
        board_reprojection_rmse_px: 0.5,
      },
    },
    pixelsPerMm: 2,
    qualityFailed: false,
    preparedPng: new Uint8Array(),
    rectifiedPng: new Uint8Array(),
    options: {
      extract: true,
      simplify_mm: 1,
      min_piece_area_mm2: 10,
      board_margin_mm: null,
      smooth: false,
    },
    outline: {
      svg: '<svg>raw</svg>',
      dxf: 'raw',
      json: { source: 'raw' },
      polygonMm: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      rawPolygonMm: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      metadata: {
        vertex_count_raw: 3,
        vertex_count_simplified: 3,
        simplify_tolerance_mm: 1,
        bounding_box_mm: [0, 0, 10, 10],
        area_mm2: 50,
        perimeter_mm: 34.14,
        segmentation: {
          background_rgb: [255, 255, 255],
          otsu_threshold: 128,
          component_count: 1,
          piece_area_mm2: 50,
          piece_pixel_count: 100,
        },
      },
      maskPng: new Uint8Array(),
    },
  };
}

describe('pipelineStore edited outline commit', () => {
  it('regenerates exported artifacts from the committed spline', () => {
    usePipelineStore.setState({ result: makeResult(), runStatus: 'success' });

    const spline = polygonToSpline([
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ]);
    usePipelineStore.getState().patchOutlineSpline(spline, 0.05);

    const state = usePipelineStore.getState();
    expect(state.editedOutline?.spline).toBe(spline);
    expect(state.result?.outline?.svg).not.toBe('<svg>raw</svg>');
    expect(state.result?.outline?.dxf).toContain('LWPOLYLINE');
    expect(state.result?.outline?.json).toMatchObject({
      source: 'edited-spline',
      polygon_mm: [
        [0, 0],
        [20, 0],
        [20, 10],
        [0, 10],
      ],
    });
    expect(state.result?.outline?.metadata.bounding_box_mm).toEqual([0, 0, 20, 10]);
    expect(state.result?.outline?.metadata.area_mm2).toBe(200);
  });
});
