export interface Question {
    id: string;
    question: string;
    type: 'text' | 'select' | 'image' | 'boolean';
    options?: string[];
    required: boolean;
    next: string | 'completion';
    validation?: {
        minLength?: number;
        maxLength?: number;
        pattern?: string;
    };
}

export interface Flow {
    name: string;
    description: string;
    department?: string;
    extends?: string;
    initial_questions: Question[];
    completion_message: string;
}

export interface Session {
    department: string;
    currentQuestion: string;
    answers: Record<string, string>;
    completed: boolean;
    lastActivity: number;
    retryCount: number;
}

export interface Ticket {
    id: string;
    title: string;
    description: string;
    department: string;
    priority: 'Critical' | 'High' | 'Medium' | 'Low';
    status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
    assignedTo: string;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface UserRequest {
    from: {
        id: string;
        name?: string;
        email?: string;
    };
    text: string;
    attachments?: any[];
}