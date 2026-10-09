import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ROIEditor } from '../ROIEditor';
import * as api from '../../services/api';
import { ROI } from '../../types';

describe('ROIEditor Component', () => {
  const defaultTestROI: ROI = [0.25, 0.35, 0.75, 0.85];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when isActive is false', () => {
    const { container } = render(
      <ROIEditor
        initialROI={defaultTestROI}
        cameraId="cam-default"
        isActive={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders ROI calibrator toolbar and coordinates when active', () => {
    render(
      <ROIEditor
        initialROI={defaultTestROI}
        cameraId="cam-default"
        isActive={true}
      />
    );

    expect(screen.getByText('ROI Calibrator')).toBeInTheDocument();
    expect(screen.getByText(/50% × 50%/)).toBeInTheDocument();
    expect(screen.getByText('DRAG GRATE ROI')).toBeInTheDocument();
  });

  it('resets to the full-frame default ROI [0, 0, 1, 1] when Reset button is clicked', () => {
    const customROI: ROI = [0.10, 0.10, 0.50, 0.50];
    render(
      <ROIEditor
        initialROI={customROI}
        cameraId="cam-default"
        isActive={true}
      />
    );

    expect(screen.getByText(/40% × 40%/)).toBeInTheDocument();

    const resetBtn = screen.getByRole('button', { name: /Reset/i });
    fireEvent.click(resetBtn);

    expect(screen.getByText(/100% × 100%/)).toBeInTheDocument();
  });

  it('saves calibrated ROI via saveROI API and invokes onSave callback', async () => {
    const saveSpy = vi.spyOn(api, 'saveROI').mockResolvedValue({
      success: true,
      roi: defaultTestROI,
    });
    const handleSave = vi.fn();

    render(
      <ROIEditor
        initialROI={defaultTestROI}
        cameraId="cam-default"
        isActive={true}
        onSave={handleSave}
      />
    );

    const saveBtn = screen.getByRole('button', { name: /Save Grate ROI/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledWith('cam-default', defaultTestROI);
      expect(handleSave).toHaveBeenCalledWith(defaultTestROI);
      expect(screen.getByText('Saved!')).toBeInTheDocument();
    });
  });

  it('calls onClose callback when Done button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <ROIEditor
        initialROI={defaultTestROI}
        cameraId="cam-default"
        isActive={true}
        onClose={handleClose}
      />
    );

    const doneBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(doneBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('clamps coordinates within normalized bounds [0, 1] during drag interactions', () => {
    const { container } = render(
      <ROIEditor
        initialROI={[0.1, 0.1, 0.4, 0.4]}
        cameraId="cam-default"
        isActive={true}
      />
    );

    const editorContainer = container.querySelector('div.select-none');
    expect(editorContainer).not.toBeNull();

    // Mock getBoundingClientRect
    vi.spyOn(editorContainer!, 'getBoundingClientRect').mockReturnValue({
      width: 1000,
      height: 1000,
      top: 0,
      left: 0,
      bottom: 1000,
      right: 1000,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Find the move box
    const moveBox = container.querySelector('.cursor-move');
    expect(moveBox).not.toBeNull();

    // Start drag on move box
    fireEvent.mouseDown(moveBox!, { clientX: 100, clientY: 100 });

    // Drag far to the right and down past 1.0 boundary
    fireEvent.mouseMove(window, { clientX: 2000, clientY: 2000 });
    fireEvent.mouseUp(window);

    // Box dimensions were width = 0.3, height = 0.3
    // Clamped max xMin = 1 - 0.3 = 0.7, yMin = 1 - 0.3 = 0.7, xMax = 1.0, yMax = 1.0
    expect(screen.getByText(/30% × 30%/)).toBeInTheDocument();
  });
});
