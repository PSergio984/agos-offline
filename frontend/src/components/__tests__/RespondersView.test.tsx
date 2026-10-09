import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RespondersView } from '../RespondersView';
import * as api from '../../services/api';

describe('RespondersView Component', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(api, 'fetchResponders').mockResolvedValue([]);
    vi.spyOn(api, 'fetchResponderGroups').mockResolvedValue([]);
    vi.spyOn(api, 'fetchNotificationTemplates').mockResolvedValue([]);
    vi.spyOn(api, 'fetchNotificationLogs').mockResolvedValue([]);
  });

  it('renders all 5 sub-tabs with simplified barangay names', async () => {
    await act(async () => {
      render(<RespondersView />);
    });

    expect(screen.getAllByRole('button', { name: /Message Templates/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Send Alert/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Responder Teams/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Responders List/i })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Sent Alerts History/i })[0]).toBeInTheDocument();
  });

  it('displays Message Templates tab with simplified title, description, and placeholders', async () => {
    await act(async () => {
      render(<RespondersView />);
    });

    expect(screen.getByRole('heading', { name: 'Message Templates' })).toBeInTheDocument();
    expect(
      screen.getByText('Saved messages you can send to teams during heavy rain or blockage.')
    ).toBeInTheDocument();
  });

  it('switches to Send Alert tab with simplified title, team selector, preview, and button', async () => {
    await act(async () => {
      render(<RespondersView />);
    });

    const sendAlertTabBtn = screen.getAllByRole('button', { name: /Send Alert/i })[0];
    await act(async () => {
      fireEvent.click(sendAlertTabBtn);
    });

    expect(screen.getByRole('heading', { name: 'Send Alert to Team' })).toBeInTheDocument();
    expect(screen.getByText('Target Responder Team')).toBeInTheDocument();
    expect(screen.getByText('Message Preview (What will be sent)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Alert to Team' })).toBeInTheDocument();
  });

  it('evaluates both {blockage_level} and {occlusion_ratio} placeholders in Send Alert tab', async () => {
    await act(async () => {
      render(<RespondersView />);
    });

    const sendAlertTabBtn = screen.getAllByRole('button', { name: /Send Alert/i })[0];
    await act(async () => {
      fireEvent.click(sendAlertTabBtn);
    });

    // Verify rendered preview doesn't have double %% and contains the blockage level
    const previewMessage = screen.getByText(/Blockage level: 78\.4%/i);
    expect(previewMessage).toBeInTheDocument();
    expect(previewMessage.textContent).not.toContain('%%');
    expect(previewMessage.textContent).toContain('URGENT: Canal blockage detected');
  });

  it('switches to Responder Teams tab with simplified description', async () => {
    await act(async () => {
      render(<RespondersView />);
    });

    const teamsTabBtn = screen.getAllByRole('button', { name: /Responder Teams/i })[0];
    await act(async () => {
      fireEvent.click(teamsTabBtn);
    });

    expect(screen.getByRole('heading', { name: 'Responder Teams' })).toBeInTheDocument();
    expect(
      screen.getByText('Emergency response teams ready to clear drains and help the community.')
    ).toBeInTheDocument();
  });

  it('switches to Responders List tab with simplified description', async () => {
    await act(async () => {
      render(<RespondersView />);
    });

    const respondersTabBtn = screen.getAllByRole('button', { name: /Responders List/i })[0];
    await act(async () => {
      fireEvent.click(respondersTabBtn);
    });

    expect(screen.getByRole('heading', { name: 'Responders List' })).toBeInTheDocument();
    expect(
      screen.getByText('Barangay responders and staff who receive alerts.')
    ).toBeInTheDocument();
  });

  it('switches to Sent Alerts History tab with simplified title and description', async () => {
    await act(async () => {
      render(<RespondersView />);
    });

    const historyTabBtn = screen.getAllByRole('button', { name: /Sent Alerts History/i })[0];
    await act(async () => {
      fireEvent.click(historyTabBtn);
    });

    expect(screen.getByRole('heading', { name: 'Sent Alerts History' })).toBeInTheDocument();
    expect(
      screen.getByText('List of alerts sent to responders.')
    ).toBeInTheDocument();
  });

  it('opens the New dropdown from any tab, lists 3 create actions, and closes on Escape', async () => {
    await act(async () => {
      render(<RespondersView />);
    });

    // Dropdown must be available from a non-templates tab too
    const logsTabBtn = screen.getAllByRole('button', { name: /Sent Alerts History/i })[0];
    await act(async () => {
      fireEvent.click(logsTabBtn);
    });
    expect(screen.getByRole('heading', { name: 'Sent Alerts History' })).toBeInTheDocument();

    const newBtn = screen.getByRole('button', { name: 'New' });
    expect(newBtn).toHaveAttribute('aria-haspopup', 'menu');
    expect(newBtn).toHaveAttribute('aria-expanded', 'false');

    await act(async () => {
      fireEvent.click(newBtn);
    });

    expect(newBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);

    // Selecting an item opens the corresponding modal and closes the menu
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /New Template/i }));
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByText('Create Message Template')).toBeInTheDocument();

    // Reopen and dismiss with Escape
    await act(async () => {
      fireEvent.click(newBtn);
    });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
