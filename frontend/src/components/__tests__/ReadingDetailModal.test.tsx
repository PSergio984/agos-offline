import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadingDetailModal } from '../ReadingDetailModal';
import { IncidentRecord } from '../../types';

describe('ReadingDetailModal Component', () => {
  const mockIncident: IncidentRecord = {
    id: 'inc-999',
    timestamp: '2026-10-09T08:30:00Z',
    status: 'WARNING',
    occlusion_ratio: 42.5,
    camera_id: 'CAM-01',
    camera_name: 'CAM-01: Rizal Culvert',
    location: 'Rizal Avenue Culvert',
    resolved: false,
    debris_types: ['Plastic Bottles', 'Tree Branches'],
    thumbnail_url: 'https://example.com/thumb.jpg',
  };

  it('renders nothing when incident is null or isOpen is false', () => {
    const { container, rerender } = render(
      <ReadingDetailModal incident={null} isOpen={true} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();

    rerender(
      <ReadingDetailModal incident={mockIncident} isOpen={false} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal details matching agos-admin design', () => {
    render(
      <ReadingDetailModal
        incident={mockIncident}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    // Title and Status
    expect(screen.getByText(/Detection #inc-999/i)).toBeInTheDocument();
    expect(screen.getByText('Possible Surface Obstruction')).toBeInTheDocument();

    // Metric Cards
    expect(screen.getByText(/Visible Surface Coverage/i)).toBeInTheDocument();
    expect(screen.getByText('42.5%')).toBeInTheDocument();
    expect(screen.getByText(/Camera/i)).toBeInTheDocument();
    expect(screen.getAllByText(/CAM-01: Rizal Culvert/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Detected/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Recorded/i).length).toBeGreaterThanOrEqual(1);

    // Debris badges
    expect(screen.getByText('Plastic Bottles')).toBeInTheDocument();
    expect(screen.getByText('Tree Branches')).toBeInTheDocument();
  });

  it('triggers onResolve callback when Mark as Resolved button is clicked', () => {
    const handleResolve = vi.fn();
    render(
      <ReadingDetailModal
        incident={mockIncident}
        isOpen={true}
        onClose={vi.fn()}
        onResolve={handleResolve}
      />
    );

    const resolveBtn = screen.getByRole('button', { name: /Mark as Resolved/i });
    expect(resolveBtn).toBeInTheDocument();
    fireEvent.click(resolveBtn);

    expect(handleResolve).toHaveBeenCalledWith('inc-999');
  });

  it('triggers onVoiceRadioDispatch callback when Voice Radio Dispatch button is clicked', () => {
    const handleDispatch = vi.fn();
    render(
      <ReadingDetailModal
        incident={mockIncident}
        isOpen={true}
        onClose={vi.fn()}
        onVoiceRadioDispatch={handleDispatch}
      />
    );

    const voiceBtn = screen.getByRole('button', { name: /Voice Radio Dispatch/i });
    expect(voiceBtn).toBeInTheDocument();
    fireEvent.click(voiceBtn);

    expect(handleDispatch).toHaveBeenCalledWith(mockIncident);
  });

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <ReadingDetailModal
        incident={mockIncident}
        isOpen={true}
        onClose={handleClose}
      />
    );

    const closeBtn = screen.getByRole('button', { name: /Close detection detail/i });
    fireEvent.click(closeBtn);

    expect(handleClose).toHaveBeenCalled();
  });
});

