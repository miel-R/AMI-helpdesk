import * as fs from 'fs';
import * as path from 'path';

export interface ProcessedImageData {
    fileName: string;
    mimeType: string;
    base64Data: string;
    savedPath: string;
}

export interface BotAttachment {
    contentType?: string;
    contentUrl?: string;
    name?: string;
    content?: any;
}

export class ImageHandler {
    constructor(
        private allowedTypes: string[],
        private maxSizeMB: number,
        private uploadDir: string
    ) {
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
    }

    public async handleAttachments(attachments: BotAttachment[]): Promise<ProcessedImageData | null> {
        try {
            if (!attachments || attachments.length === 0) return null;

            for (const attachment of attachments) {
                if (attachment.contentType && this.allowedTypes.includes(attachment.contentType)) {
                    return await this.processImage(attachment);
                }
            }
            return null;
        } catch (error) {
            console.error('Image handling error:', error);
            return null;
        }
    }

    private async processImage(attachment: BotAttachment): Promise<ProcessedImageData | null> {
        let imageData: Buffer | null = null;
        const fileName = attachment.name || 'image.jpg';
        let mimeType = attachment.contentType || 'image/jpeg';

        if (attachment.contentUrl?.startsWith('data:')) {
            const matches = attachment.contentUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches) {
                mimeType = matches[1];
                imageData = Buffer.from(matches[2], 'base64');
            }
        } else if (attachment.contentUrl?.startsWith('http')) {
            try {
                const response = await fetch(attachment.contentUrl);
                imageData = Buffer.from(await response.arrayBuffer());
            } catch (error) {
                console.error('Image download failed:', error);
            }
        }

        if (!imageData) return null;

        const savedPath = path.join(this.uploadDir, `${Date.now()}_${fileName}`);
        fs.writeFileSync(savedPath, imageData);

        return {
            fileName,
            mimeType,
            base64Data: imageData.toString('base64'),
            savedPath
        };
    }

    private isValidImageUrl(url: string): boolean {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' &&
                (parsed.hostname.endsWith('.microsoft.com') ||
                    parsed.hostname === 'your-trusted-domain.com');
        } catch {
            return false;
        }
    }
}