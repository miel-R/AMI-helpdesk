import * as fs from 'fs';
import * as path from 'path';
import { Flow, Session } from '../core/types';
import { cache } from '../cache/memory.cache';
import { logger } from '../utils/logger';

export class FlowService {
    private flows: Map<string, Flow> = new Map();
    private departments: string[] = [];

    constructor() {
        this.loadFlows();
    }

    private loadFlows(): void {
        try {
            // Load base flow
            const basePath = path.join(__dirname, '../flows/shared/base-flow.json');
            if (fs.existsSync(basePath)) {
                const data = JSON.parse(fs.readFileSync(basePath, 'utf-8'));
                this.flows.set('base', data.base_flow);
                cache.set('flow:base', data.base_flow);
            }

            // Load department flows
            const deptPath = path.join(__dirname, '../flows/departments');
            if (fs.existsSync(deptPath)) {
                const depts = fs.readdirSync(deptPath);

                for (const dept of depts) {
                    const deptDir = path.join(deptPath, dept);
                    if (fs.statSync(deptDir).isDirectory()) {
                        this.departments.push(dept);

                        const flowFile = path.join(deptDir, 'flow.json');
                        if (fs.existsSync(flowFile)) {
                            const data = JSON.parse(fs.readFileSync(flowFile, 'utf-8'));
                            this.flows.set(dept, data.flow);
                            cache.set(`flow:${dept}`, data.flow);
                        }
                    }
                }
            }

            logger.success(`Loaded ${this.flows.size} flows for ${this.departments.length} departments`);
        } catch (error) {
            logger.error('Error loading flows:', error);
        }
    }

    getFlow(department: string): Flow | undefined {
        const cached = cache.get<Flow>(`flow:${department}`);
        if (cached) return cached;

        const flow = this.flows.get(department) || this.flows.get('base');
        if (flow) {
            cache.set(`flow:${department}`, flow);
        }
        return flow;
    }

    getDepartments(): string[] {
        return this.departments;
    }

    detectDepartment(text: string): string {
        const textLower = text.toLowerCase();
        let bestMatch = 'base';
        let maxScore = 0;

        for (const dept of this.departments) {
            const rulesPath = path.join(__dirname, `../flows/departments/${dept}/rules.json`);
            if (!fs.existsSync(rulesPath)) continue;

            try {
                const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
                let score = 0;
                for (const keyword of rules.keywords || []) {
                    if (textLower.includes(keyword.toLowerCase())) {
                        score++;
                    }
                }
                if (score > maxScore) {
                    maxScore = score;
                    bestMatch = dept;
                }
            } catch (error) {
                logger.error(`Error loading rules for ${dept}:`, error);
            }
        }

        return bestMatch;
    }

    shouldCreateTicket(session: Session): boolean {
        const answers = session.answers;
        const hasComplexity = answers.complexity === 'High' || answers.complexity === 'Critical' ||
            answers.urgency === 'Critical' || answers.urgency === 'High';
        const hasDetailedInfo = Object.keys(answers).length > 5;
        return hasComplexity || hasDetailedInfo;
    }

    canAutoResolve(session: Session): boolean {
        const simpleIssues = ['Password Reset', 'Access Request', 'How to', 'Question'];
        const issueType = session.answers.issue_type || '';
        const isSimple = simpleIssues.some(issue => issueType.toLowerCase().includes(issue.toLowerCase()));
        const isLowPriority = session.answers.urgency === 'Low' || session.answers.urgency === 'Medium';
        return isSimple || isLowPriority;
    }

    reload(): void {
        cache.flush();
        this.flows.clear();
        this.departments = [];
        this.loadFlows();
    }
}

export const flowService = new FlowService();