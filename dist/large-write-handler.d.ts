declare function writeFileWithRetry(filePath: string, content: string, encoding: BufferEncoding, chunkSize: number, maxRetries: number, append: boolean): Promise<{
    retryCount: number;
}>;
declare function writeFileStreaming(filePath: string, content: string, encoding: BufferEncoding, chunkSize: number, append: boolean): Promise<void>;
declare function checkDiskSpace(dirPath: string, requiredBytes: number): Promise<void>;
declare function getOriginalFileSize(filePath: string): Promise<number>;
//# sourceMappingURL=large-write-handler.d.ts.map