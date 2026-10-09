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

  it('switches to Sent Alerts History tab with search, filters, and pagination', async () => {
    const mockLogs = [
      {
        id: 'log-1',
        type: 'blockage',
        title: 'Curb Grate Blockage',
        message: 'Water impeded at Sector 1',
        target_group_id: 'grp-1',
        target_group_name: 'Poblacion QRT',
        recipient_count: 3,
        status: 'DISPATCHED',
        created_at: '2026-10-10 10:00:00',
      },
      {
        id: 'log-2',
        type: 'warning',
        title: 'Rising Inflow Warning',
        message: 'High flow at Culvert 2',
        target_group_id: 'grp-2',
        target_group_name: 'Drainage Crew',
        recipient_count: 2,
        status: 'DISPATCHED',
        created_at: '2026-10-10 10:15:00',
      },
    ];
    vi.spyOn(api, 'fetchNotificationLogs').mockResolvedValue(mockLogs);

    await act(async () => {
      render(<RespondersView />);
    });

    const historyTabBtn = screen.getAllByRole('button', { name: /Sent Alerts History/i })[0];
    await act(async () => {
      fireEvent.click(historyTabBtn);
    });

    expect(screen.getByRole('heading', { name: 'Sent Alerts History' })).toBeInTheDocument();
    expect(
      screen.getByText(/Search, filter by alert category or team, and inspect dispatched alerts./i)
    ).toBeInTheDocument();
    expect(screen.getByText('Curb Grate Blockage')).toBeInTheDocument();
    expect(screen.getByText('Rising Inflow Warning')).toBeInTheDocument();

    // Test Category filter pill
    const warningPill = screen.getByRole('button', { name: /Warning/i });
    await act(async () => {
      fireEvent.click(warningPill);
    });
    expect(screen.queryByText('Curb Grate Blockage')).not.toBeInTheDocument();
    expect(screen.getByText('Rising Inflow Warning')).toBeInTheDocument();

    // Reset to All
    const allPill = screen.getByRole('button', { name: /^All\s*\d*$/i });
    await act(async () => {
      fireEvent.click(allPill);
    });
    expect(screen.getByText('Curb Grate Blockage')).toBeInTheDocument();

    // Test Search input
    const searchInput = screen.getByPlaceholderText('Search logs...');
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Sector 1' } });
    });
    expect(screen.getByText('Curb Grate Blockage')).toBeInTheDocument();
    expect(screen.queryByText('Rising Inflow Warning')).not.toBeInTheDocument();
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

  it('allows opening the Edit Team modal and managing team members', async () => {
    const mockGroups = [
      {
        id: 'grp-test',
        name: 'Quick Response Team',
        description: 'First responders for flood gates',
        member_count: 1,
        member_ids: ['resp-1'],
      },
    ];
    const mockResponders = [
      {
        id: 'resp-1',
        first_name: 'Juan',
        last_name: 'Dela Cruz',
        phone_number: '+639171234567',
        status: 'active',
        location: 'Sector 1',
        notif_preferences: { warning: true, critical: true, blockage: true, announcement: true },
        group_ids: ['grp-test'],
      },
      {
        id: 'resp-2',
        first_name: 'Maria',
        last_name: 'Santos',
        phone_number: '+639182345678',
        status: 'active',
        location: 'Sector 2',
        notif_preferences: { warning: true, critical: true, blockage: true, announcement: true },
        group_ids: [],
      },
    ];

    vi.spyOn(api, 'fetchResponderGroups').mockResolvedValue(mockGroups);
    vi.spyOn(api, 'fetchResponders').mockResolvedValue(mockResponders);
    const updateGroupSpy = vi.spyOn(api, 'updateResponderGroup').mockResolvedValue({
      ...mockGroups[0],
      member_count: 2,
      member_ids: ['resp-1', 'resp-2'],
    });

    await act(async () => {
      render(<RespondersView />);
    });

    // Switch to Responder Teams sub-tab
    const teamsTabBtn = screen.getAllByRole('button', { name: /Responder Teams/i })[0];
    await act(async () => {
      fireEvent.click(teamsTabBtn);
    });

    // Verify team card renders with members and Edit button
    expect(screen.getByText('Quick Response Team')).toBeInTheDocument();
    expect(screen.getByText('Manage Roster')).toBeInTheDocument();

    const editBtn = screen.getByRole('button', { name: /Edit/i });
    await act(async () => {
      fireEvent.click(editBtn);
    });

    // Modal opens in Edit mode
    expect(screen.getByText(/Edit Team: Quick Response Team/i)).toBeInTheDocument();
    expect(screen.getByText(/Assign Team Members/i)).toBeInTheDocument();

    // Toggle Maria Santos into the group
    const mariaCheckbox = screen.getAllByRole('checkbox').find((cb) =>
      cb.closest('label')?.textContent?.includes('Maria Santos')
    );
    expect(mariaCheckbox).toBeDefined();
    await act(async () => {
      fireEvent.click(mariaCheckbox!);
    });

    // Save changes
    const saveBtn = screen.getByRole('button', { name: /Save Team Changes/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(updateGroupSpy).toHaveBeenCalledWith('grp-test', expect.objectContaining({
      name: 'Quick Response Team',
      member_ids: expect.arrayContaining(['resp-1', 'resp-2']),
    }));
  });
});
