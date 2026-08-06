import { Ticket } from '../core/types';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { metrics } from '../utils/metrics';

export class TicketService {
    private tickets: Ticket[] = [];
    private counter = 0;

    async create(data: any): Promise<Ticket> {
        this.counter++;

        const ticket: Ticket = {
            id: `${config.ticketPrefix}-${String(this.counter).padStart(4, '0')}`,
            title: this.generateTitle(data),
            description: data.description || data.issue_description || 'No description provided',
            department: data.department || 'General',
            priority: this.determinePriority(data),
            status: 'Open',
            assignedTo: this.determineAssignee(data.department),
            createdBy: data.userName || data.userId || 'Unknown',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        this.tickets.push(ticket);
        logger.success(`🎫 Ticket created: ${ticket.id}`);
        metrics.incrementTickets();

        return ticket;
    }

    private generateTitle(data: any): string {
        const issueType = data.issue_type || 'General';
        const dept = data.department || 'General';
        const name = data.name || data.userName || 'Unknown';
        return `[${dept}] ${issueType} - ${name}`;
    }

    private determinePriority(data: any): 'Critical' | 'High' | 'Medium' | 'Low' {
        const urgency = data.urgency || data.complexity || 'Medium';
        const priorityMap: Record<string, any> = {
            'Critical': 'Critical',
            'High': 'High',
            'Medium': 'Medium',
            'Low': 'Low'
        };
        return priorityMap[urgency] || 'Medium';
    }

    private determineAssignee(department: string): string {
        const assignees: Record<string, string> = {
            'it': 'it-team@company.com',
            'engineering': 'engineering-team@company.com',
            'hr': 'hr-team@company.com',
            'manufacturing': 'manufacturing-team@company.com',
            'finance': 'finance-team@company.com'
        };
        const deptLower = department.toLowerCase();
        return assignees[deptLower] || 'helpdesk@company.com';
    }

    getTicket(id: string): Ticket | undefined {
        return this.tickets.find(t => t.id === id);
    }

    updateStatus(id: string, status: Ticket['status']): boolean {
        const ticket = this.getTicket(id);
        if (ticket) {
            ticket.status = status;
            ticket.updatedAt = new Date();
            return true;
        }
        return false;
    }

    getAllTickets(): Ticket[] {
        return this.tickets;
    }

    getTicketCount(): number {
        return this.tickets.length;
    }
}

export const ticketService = new TicketService();