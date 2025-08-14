interface Section {
    id: string;
    name: string;
    content: string;
    lineCount: number;
    size: number;
}
interface SafeWriteOptions {
    enableEmojis?: boolean;
    checkpointInterval?: number;
    autoBackup?: boolean;
    verifyWrite?: boolean;
    maxRetries?: number;
}
export declare class SafeLargeFileWriter {
    private targetPath;
    private checkpointPath;
    private backupPath;
    private sections;
    private options;
    constructor(targetPath: string, options?: SafeWriteOptions);
    private removeEmojis;
    private log;
    addSection(id: string, name: string, content: string): void;
    private saveCheckpoint;
    private loadCheckpoint;
    private createBackup;
    private restoreFromBackup;
    private verifyFileState;
    private showProgress;
    writeSafely(mode?: 'write' | 'append'): Promise<boolean>;
    getStatus(): Promise<void>;
    resetCheckpoint(): Promise<void>;
    continueFromCheckpoint(): Promise<boolean>;
    getSections(): Section[];
    getTotalSize(): number;
    getTotalLines(): number;
}
export default SafeLargeFileWriter;
//# sourceMappingURL=checkpoint-writer.d.ts.map