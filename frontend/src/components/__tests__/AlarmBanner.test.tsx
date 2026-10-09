import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AlarmBanner } from '../AlarmBanner';
import { sirenSynthesizer } from '../../services/audioSiren';

describe('AlarmBanner Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sirenSynthesizer.stop();
  });

  it('renders nothing when status is CLEAR', () => {
    const { container } = render(
      <AlarmBanner
        status="CLEAR"
        occlusionRatio={12.0}
        cameraName="CAM-01: Rizal Culvert"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders WARNING alarm banner with warning text and occlusion percentage', () => {
    render(
      <AlarmBanner
        status="WARNING"
        occlusionRatio={38.5}
        cameraName="CAM-01: Rizal Culvert"
      />
    );

    expect(screen.getByText('WARNING')).toBeInTheDocument();
    expect(screen.getByText(/38\.5% Occlusion/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Debris accumulating/i)
    ).toBeInTheDocument();
  });

  it('renders CRITICAL alarm banner with emergency text and critical badge', () => {
    render(
      <AlarmBanner
        status="CRITICAL"
        occlusionRatio={76.2}
        cameraName="CAM-01: Rizal Culvert"
      />
    );

    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    expect(screen.getByText(/76\.2% Occlusion/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Critical drainage obstruction/i)
    ).toBeInTheDocument();
  });

  it('toggles siren mute when mute button is clicked', () => {
    const setMutedSpy = vi.spyOn(sirenSynthesizer, 'setMuted');

    render(
      <AlarmBanner
        status="CRITICAL"
        occlusionRatio={82.0}
        cameraName="CAM-01: Rizal Culvert"
      />
    );

    // Initial button label
    const muteButton = screen.getByRole('button', { name: /SIREN ACTIVE/i });
    expect(muteButton).toBeInTheDocument();

    // Click mute button
    fireEvent.click(muteButton);

    expect(setMutedSpy).toHaveBeenCalledWith(true);
    expect(screen.getByText(/SIREN MUTED/i)).toBeInTheDocument();

    // Click again to unmute
    fireEvent.click(screen.getByRole('button', { name: /SIREN MUTED/i }));
    expect(setMutedSpy).toHaveBeenCalledWith(false);
    expect(screen.getByText(/SIREN ACTIVE/i)).toBeInTheDocument();
  });

  it('triggers onOpenRadioDispatch when Radio Dispatch Ticket button is clicked', () => {
    const handleRadioDispatch = vi.fn();

    render(
      <AlarmBanner
        status="CRITICAL"
        occlusionRatio={88.0}
        cameraName="CAM-01: Rizal Culvert"
        onOpenRadioDispatch={handleRadioDispatch}
      />
    );

    const dispatchBtn = screen.getByRole('button', { name: /Dispatch Radio Team/i });
    expect(dispatchBtn).toBeInTheDocument();

    fireEvent.click(dispatchBtn);
    expect(handleRadioDispatch).toHaveBeenCalledTimes(1);
  });

  it('displays ACKNOWLEDGED BY DESK badge when Acknowledge button is clicked', () => {
    render(
      <AlarmBanner
        status="WARNING"
        occlusionRatio={45.0}
        cameraName="CAM-01: Rizal Culvert"
      />
    );

    const ackButton = screen.getByRole('button', { name: /Acknowledge/i });
    expect(ackButton).toBeInTheDocument();

    fireEvent.click(ackButton);

    expect(screen.getByText(/Acknowledged/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Acknowledge$/i })).not.toBeInTheDocument();
  });
});
