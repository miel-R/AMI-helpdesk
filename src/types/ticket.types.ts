export interface Ticket {
    id: string;
    userId: string;
    userName: string;
    category: string;
    description: string;
    status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
    priority: 'High' | 'Medium' | 'Low';
    createdAt: Date;
    attachments?: string[];
}