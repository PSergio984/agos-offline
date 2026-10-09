import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RadioDispatchModal, generateFallbackTicketId } from '../RadioDispatchModal';

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  cameraName: 'CAM-01',
  cameraId: 'cam-01',
  occlusionRatio: 72.0,
  status: 'CRITICAL',
};

describe('RadioDispatchModal rain hazard', () => {
  it('shows the rain warning only when rainHazard is true', () => {
    const { rerender } = render(<RadioDispatchModal {...baseProps} />);
    expect(screen.queryByText(/Rain hazard/i)).toBeNull();

    rerender(<RadioDispatchModal {...baseProps} rainHazard={true} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Rain hazard/i);
  });

  it('still dispatches while the rain warning is shown', () => {
    const onDispatched = vi.fn();
    render(<RadioDispatchModal {...baseProps} rainHazard={true} onDispatched={onDispatched} />);
    fireEvent.click(screen.getByRole('button', { name: /Mark Unit Dispatched/i }));
    expect(onDispatched).toHaveBeenCalledTimes(1);
  });

  it('renders shared ticket ID in radio script and header', () => {
    render(<RadioDispatchModal {...baseProps} initialRadioTicket="RAD-ALPHA1" />);
    expect(screen.getAllByText(/Ticket RAD-ALPHA1/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Dispatch ticket RAD-ALPHA1/i)).toBeInTheDocument();
  });

  it('generates fallback ticket IDs with RAD- prefix', () => {
    const id = generateFallbackTicketId();
    expect(id).toMatch(/^RAD-[A-Z0-9]+$/);
  });
});

