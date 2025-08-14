"use strict";
// 대용량 파일 전용 강화된 작성 함수
async function handleLargeWriteFile(args) {
    const { path: filePath, content, encoding = 'utf-8', create_dirs = true, append = false, chunk_size = 64 * 1024, // 64KB 청크
    backup = true, retry_attempts = 3, verify_write = true } = args;
    let targetPath;
    if (path.isAbsolute(filePath)) {
        targetPath = filePath;
    }
    else {
        targetPath = path.join(process.cwd(), filePath);
    }
    if (!isPathAllowed(targetPath)) {
        throw new Error(`Access denied to path: ${targetPath}`);
    }
    const resolvedPath = path.resolve(targetPath);
    const tempPath = `${resolvedPath}.tmp.${Date.now()}`;
    const backupPath = `${resolvedPath}.backup.${Date.now()}`;
    try {
        // 1. 디렉토리 생성
        if (create_dirs) {
            const dir = path.dirname(resolvedPath);
            await fs.mkdir(dir, { recursive: true });
        }
        // 2. 디스크 공간 확인
        const contentSize = Buffer.byteLength(content, encoding);
        await checkDiskSpace(path.dirname(resolvedPath), contentSize);
        // 3. 기존 파일 백업 (덮어쓰기 모드이고 파일이 존재할 경우)
        let originalExists = false;
        if (!append && backup) {
            try {
                await fs.access(resolvedPath);
                originalExists = true;
                await fs.copyFile(resolvedPath, backupPath);
            }
            catch {
                // 원본 파일이 없으면 무시
            }
        }
        // 4. 스트리밍 방식으로 대용량 파일 작성
        const startTime = Date.now();
        const result = await writeFileWithRetry(append ? resolvedPath : tempPath, content, encoding, chunk_size, retry_attempts, append);
        // 5. 원자적 이동 (append가 아닌 경우)
        if (!append) {
            await fs.rename(tempPath, resolvedPath);
        }
        // 6. 작성 검증 (옵션)
        if (verify_write) {
            const finalStats = await fs.stat(resolvedPath);
            const expectedSize = append ?
                contentSize + (originalExists ? (await getOriginalFileSize(backupPath)) : 0) :
                contentSize;
            if (Math.abs(finalStats.size - expectedSize) > chunk_size) {
                throw new Error(`File size verification failed. Expected: ${expectedSize}, Actual: ${finalStats.size}`);
            }
        }
        // 7. 성공 후 백업 정리 옵션
        const totalTime = Date.now() - startTime;
        const finalStats = await fs.stat(resolvedPath);
        return {
            message: `Large file ${append ? 'appended' : 'written'} successfully`,
            path: resolvedPath,
            size: finalStats.size,
            size_readable: formatSize(finalStats.size),
            content_size: contentSize,
            content_size_readable: formatSize(contentSize),
            encoding: encoding,
            mode: append ? 'append' : 'write',
            chunks_written: Math.ceil(contentSize / chunk_size),
            chunk_size: chunk_size,
            chunk_size_readable: formatSize(chunk_size),
            backup_created: originalExists && backup ? backupPath : null,
            timestamp: new Date().toISOString(),
            performance: {
                total_time_ms: totalTime,
                write_speed_mbps: (contentSize / (1024 * 1024)) / (totalTime / 1000),
                chunks_per_second: (Math.ceil(contentSize / chunk_size)) / (totalTime / 1000)
            },
            reliability: {
                retry_attempts_used: result.retryCount,
                verification_passed: verify_write,
                atomic_operation: !append
            }
        };
    }
    catch (error) {
        // 에러 복구
        try {
            // 임시 파일 정리
            await fs.unlink(tempPath).catch(() => { });
            // 백업에서 복구 (필요시)
            if (originalExists && backup && !append) {
                try {
                    await fs.copyFile(backupPath, resolvedPath);
                }
                catch (restoreError) {
                    console.error('Failed to restore from backup:', restoreError);
                }
            }
            // 백업 파일 정리
            if (originalExists && backup) {
                await fs.unlink(backupPath).catch(() => { });
            }
        }
        catch (cleanupError) {
            console.error('Cleanup failed:', cleanupError);
        }
        throw new Error(`Large file write failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
// 스트리밍 방식 파일 작성 (재시도 포함)
async function writeFileWithRetry(filePath, content, encoding, chunkSize, maxRetries, append) {
    let retryCount = 0;
    while (retryCount <= maxRetries) {
        try {
            await writeFileStreaming(filePath, content, encoding, chunkSize, append);
            return { retryCount };
        }
        catch (error) {
            retryCount++;
            if (retryCount > maxRetries) {
                throw error;
            }
            // 지수 백오프 대기
            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
            await new Promise(resolve => setTimeout(resolve, delay));
            console.error(`Write attempt ${retryCount} failed, retrying in ${delay}ms...`, error);
        }
    }
    throw new Error('Max retry attempts exceeded');
}
// 실제 스트리밍 작성
async function writeFileStreaming(filePath, content, encoding, chunkSize, append) {
    const buffer = Buffer.from(content, encoding);
    const fileHandle = await fs.open(filePath, append ? 'a' : 'w');
    try {
        let position = 0;
        while (position < buffer.length) {
            const end = Math.min(position + chunkSize, buffer.length);
            const chunk = buffer.subarray(position, end);
            await fileHandle.write(chunk);
            position = end;
            // 대용량 파일의 경우 잠시 yield하여 다른 작업 허용
            if (position % (chunkSize * 10) === 0) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
        await fileHandle.sync(); // 디스크에 강제 동기화
    }
    finally {
        await fileHandle.close();
    }
}
// 디스크 공간 확인
async function checkDiskSpace(dirPath, requiredBytes) {
    try {
        const { stdout } = await execAsync(`df -B1 "${dirPath}" | tail -1 | awk '{print $4}'`);
        const availableBytes = parseInt(stdout.trim());
        if (availableBytes < requiredBytes * 1.5) { // 50% 버퍼
            throw new Error(`Insufficient disk space. Required: ${formatSize(requiredBytes)}, ` +
                `Available: ${formatSize(availableBytes)}, ` +
                `Recommended: ${formatSize(requiredBytes * 1.5)}`);
        }
    }
    catch (error) {
        // df 명령어가 실패하면 경고만 출력
        console.warn('Could not check disk space:', error);
    }
}
// 원본 파일 크기 가져오기
async function getOriginalFileSize(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    }
    catch {
        return 0;
    }
}
//# sourceMappingURL=large-write-handler.js.map