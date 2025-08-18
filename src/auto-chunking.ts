// 자동 청킹 시스템
// 응답 크기가 1MB를 넘기 전에 자동으로 분할하는 기능

export interface ContinuationToken {
  type: 'read_file' | 'list_directory' | 'search_files' | 'search_code';
  path: string;
  
  // 파일 읽기용
  line_start?: number;
  byte_offset?: number;
  
  // 디렉토리 리스팅용
  page?: number;
  last_item?: string;
  
  // 검색용
  last_file?: string;
  last_position?: number;
  file_index?: number;
  
  // 공통
  chunk_id: string;
  timestamp: number;
  params: any; // 원본 파라미터들
}

export class ResponseSizeMonitor {
  private currentSize: number = 0;
  private readonly maxSize: number;
  private readonly warningThreshold: number;
  
  constructor(maxSizeMB: number = 0.9) { // 900KB로 안전 마진
    this.maxSize = maxSizeMB * 1024 * 1024;
    this.warningThreshold = this.maxSize * 0.85; // 85%에서 경고
  }
  
  reset(): void {
    this.currentSize = 0;
  }
  
  estimateSize(obj: any): number {
    // JSON 직렬화 크기 추정 (오버헤드 포함)
    const jsonStr = JSON.stringify(obj);
    return Buffer.byteLength(jsonStr, 'utf8') * 1.2; // 20% 마진
  }
  
  addContent(content: any): boolean {
    const contentSize = this.estimateSize(content);
    this.currentSize += contentSize;
    return this.currentSize < this.maxSize;
  }
  
  canAddContent(content: any): boolean {
    const contentSize = this.estimateSize(content);
    return (this.currentSize + contentSize) < this.maxSize;
  }
  
  isNearLimit(): boolean {
    return this.currentSize > this.warningThreshold;
  }
  
  getCurrentSize(): number {
    return this.currentSize;
  }
  
  getMaxSize(): number {
    return this.maxSize;
  }
  
  getRemainingSize(): number {
    return Math.max(0, this.maxSize - this.currentSize);
  }
  
  getSizeInfo() {
    return {
      current_size: this.currentSize,
      max_size: this.maxSize,
      remaining_size: this.getRemainingSize(),
      usage_percentage: (this.currentSize / this.maxSize) * 100,
      is_near_limit: this.isNearLimit()
    };
  }
}

export class ContinuationTokenManager {
  private tokens: Map<string, ContinuationToken> = new Map();
  private readonly TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30분
  
  generateToken(type: ContinuationToken['type'], path: string, params: any): string {
    const tokenId = `${type}_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    
    const token: ContinuationToken = {
      type,
      path,
      chunk_id: tokenId,
      timestamp: Date.now(),
      params: { ...params }
    };
    
    this.tokens.set(tokenId, token);
    this.cleanupExpiredTokens();
    
    return tokenId;
  }
  
  getToken(tokenId: string): ContinuationToken | null {
    const token = this.tokens.get(tokenId);
    if (!token) return null;
    
    // 토큰 만료 확인
    if (Date.now() - token.timestamp > this.TOKEN_EXPIRY_MS) {
      this.tokens.delete(tokenId);
      return null;
    }
    
    return token;
  }
  
  updateToken(tokenId: string, updates: Partial<ContinuationToken>): boolean {
    const token = this.tokens.get(tokenId);
    if (!token) return false;
    
    Object.assign(token, updates);
    return true;
  }
  
  deleteToken(tokenId: string): boolean {
    return this.tokens.delete(tokenId);
  }
  
  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [tokenId, token] of this.tokens.entries()) {
      if (now - token.timestamp > this.TOKEN_EXPIRY_MS) {
        this.tokens.delete(tokenId);
      }
    }
  }
  
  getActiveTokenCount(): number {
    this.cleanupExpiredTokens();
    return this.tokens.size;
  }
}

// 자동 청킹 헬퍼 함수들
export class AutoChunkingHelper {
  
  // 배열을 응답 크기 제한에 맞게 자동 분할
  static chunkArray<T>(
    items: T[], 
    monitor: ResponseSizeMonitor,
    estimateItemSize: (item: T) => any
  ): { 
    chunks: T[], 
    hasMore: boolean, 
    remainingItems: T[] 
  } {
    const chunks: T[] = [];
    let i = 0;
    
    while (i < items.length) {
      const item = items[i];
      const estimatedItem = estimateItemSize(item);
      
      if (!monitor.canAddContent(estimatedItem)) {
        break;
      }
      
      monitor.addContent(estimatedItem);
      chunks.push(item);
      i++;
    }
    
    return {
      chunks,
      hasMore: i < items.length,
      remainingItems: items.slice(i)
    };
  }
  
  // 텍스트를 라인 단위로 안전하게 분할
  static chunkTextByLines(
    text: string,
    monitor: ResponseSizeMonitor,
    startLine: number = 0
  ): {
    content: string,
    hasMore: boolean,
    nextStartLine: number,
    totalLines: number
  } {
    const lines = text.split('\n');
    const contentLines: string[] = [];
    let currentLine = startLine;
    
    while (currentLine < lines.length) {
      const line = lines[currentLine] + '\n';
      
      if (!monitor.canAddContent({ line })) {
        break;
      }
      
      monitor.addContent({ line });
      contentLines.push(lines[currentLine]);
      currentLine++;
    }
    
    return {
      content: contentLines.join('\n'),
      hasMore: currentLine < lines.length,
      nextStartLine: currentLine,
      totalLines: lines.length
    };
  }
  
  // 바이트 단위로 안전하게 분할
  static chunkByBytes(
    buffer: Buffer,
    monitor: ResponseSizeMonitor,
    startOffset: number = 0,
    encoding: BufferEncoding = 'utf-8'
  ): {
    content: string,
    hasMore: boolean,
    nextOffset: number,
    bytesRead: number
  } {
    let currentOffset = startOffset;
    let bytesRead = 0;
    const maxChunkSize = Math.min(monitor.getRemainingSize() / 2, buffer.length - startOffset);
    
    // 안전한 텍스트 경계 찾기 (UTF-8 고려)
    let safeEndOffset = startOffset;
    const testChunkSize = Math.min(4096, maxChunkSize); // 4KB씩 테스트
    
    while (safeEndOffset < buffer.length && (safeEndOffset - startOffset) < maxChunkSize) {
      const nextOffset = Math.min(safeEndOffset + testChunkSize, buffer.length);
      const chunk = buffer.subarray(startOffset, nextOffset);
      
      try {
        const content = chunk.toString(encoding);
        const contentObj = { content };
        
        if (!monitor.canAddContent(contentObj)) {
          break;
        }
        
        safeEndOffset = nextOffset;
        bytesRead = nextOffset - startOffset;
      } catch (error) {
        // UTF-8 디코딩 오류 - 이전 안전한 위치로 롤백
        break;
      }
    }
    
    const finalChunk = buffer.subarray(startOffset, safeEndOffset);
    const content = finalChunk.toString(encoding);
    
    monitor.addContent({ content });
    
    return {
      content,
      hasMore: safeEndOffset < buffer.length,
      nextOffset: safeEndOffset,
      bytesRead
    };
  }
}

// 응답 포맷 헬퍼
export interface ChunkedResponse {
  // 실제 데이터
  [key: string]: any;
  
  // 청킹 메타데이터
  chunking: {
    has_more: boolean;
    continuation_token?: string;
    chunk_info: {
      current_chunk: number;
      estimated_total_chunks?: number;
      progress_percentage?: number;
    };
    size_info: {
      current_size: number;
      max_size: number;
      usage_percentage: number;
    };
  };
}

export function createChunkedResponse(
  data: any,
  hasMore: boolean,
  monitor: ResponseSizeMonitor,
  continuationToken?: string,
  chunkInfo?: { current: number; total?: number; }
): ChunkedResponse {
  const response: ChunkedResponse = {
    ...data,
    chunking: {
      has_more: hasMore,
      chunk_info: {
        current_chunk: chunkInfo?.current || 1,
        estimated_total_chunks: chunkInfo?.total,
        progress_percentage: chunkInfo?.total ? 
          ((chunkInfo.current / chunkInfo.total) * 100) : undefined
      },
      size_info: {
        current_size: monitor.getCurrentSize(),
        max_size: monitor.getMaxSize(),
        usage_percentage: (monitor.getCurrentSize() / monitor.getMaxSize()) * 100
      }
    }
  };
  
  if (hasMore && continuationToken) {
    response.chunking.continuation_token = continuationToken;
  }
  
  return response;
}

// 전역 인스턴스
export const globalTokenManager = new ContinuationTokenManager();
