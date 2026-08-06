// src/types/group.types.ts

export interface GroupProfile {
    department: string;
    priorityLevel: 'High' | 'Medium' | 'Low';
    tailoredSystemPrompt: string;
    commonRoutines: Record<string, string>; // Routine Name -> Steps/Action
}

export const DEPARTMENT_PROFILES: Record<string, GroupProfile> = {
    Engineering: {
        department: 'Software Engineering',
        priorityLevel: 'High',
        tailoredSystemPrompt: 'Focus on technical debugging, repo permissions, CI/CD pipeline issues, and API rate limits. Provide code blocks and command-line solutions.',
        commonRoutines: {
            'repo_access': 'Provide link to GitHub Access Request portal and check team Lead approval.',
            'env_setup': 'Guide user through `npm install` and standard `.env.dev` setup.'
        }
    },
    HR: {
        department: 'Human Resources',
        priorityLevel: 'Medium',
        tailoredSystemPrompt: 'Focus on employee onboarding/offboarding, portal access, and hardware provisioning. Keep explanations non-technical and friendly.',
        commonRoutines: {
            'new_hire_laptop': 'Trigger standard HR hardware provisioning checklist TKT-HR-01.',
            'portal_reset': 'Direct user to self-service HR Portal identity verification.'
        }
    },
    Finance: {
        department: 'Finance & Accounting',
        priorityLevel: 'High',
        tailoredSystemPrompt: 'Prioritize ERP software errors, invoice portal access, and printer/scanner hardware. Emphasize security and compliance.',
        commonRoutines: {
            'erp_error': 'Request screenshot of error code and verify VPN connection status.'
        }
    }
};