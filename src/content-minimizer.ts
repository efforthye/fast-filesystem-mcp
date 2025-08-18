// 응답 크기 최소화 유틸리티

import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface CompressionOptions {
  enable_compression?: boolean;     // gzip 압축 사용
  summary_mode?: boolean;          // 요약 모드 (큰 내용은 요약만)
  reference_mode?: boolean;        // 참조 모드 (content_id만 반환)
  minimize_paths?: boolean;        // 경로 최소화
  minimal_metadata?: boolean;      // 최소 메타데이터만
  max_content_preview?: number;    // 내용 미리보기 최대 크기
}

export interface ContentReference {
  content_id: string;
  content_type: 'text' | 'binary' | 'directory' | 'search_results';
  size: number;
  preview?: string;
  fetch_url?: string;
}

export class ContentMinimizer {
  private contentStore = new Map<string, any>();
  private readonly PREVIEW_SIZE = 200; // 기본 미리보기 크기
  
  // 텍스트 압축
  async compressText(text: string): Promise<{ compressed: string; original_size: number; compressed_size: number }> {
    const buffer = Buffer.from(text, 'utf8');
    const compressed = await gzipAsync(buffer);
    const compressedBase64 = compressed.toString('base64');
    
    return {
      compressed: compressedBase64,
      original_size: buffer.length,
      compressed_size: compressed.length
    };
  }
  
  // 텍스트 압축 해제
  async decompressText(compressedBase64: string): Promise<string> {
    const compressed = Buffer.from(compressedBase64, 'base64');
    const decompressed = await gunzipAsync(compressed);
    return decompressed.toString('utf8');
  }
  
  // 텍스트 요약 생성
  summarizeText(text: string, maxLength: number = 500): { summary: string; is_truncated: boolean; original_length: number } {
    const lines = text.split('\n');
    const totalLength = text.length;
    
    if (totalLength <= maxLength) {
      return {
        summary: text,
        is_truncated: false,
        original_length: totalLength
      };
    }
    
    // 첫 부분 + 중간 부분 + 끝 부분으로 요약
    const partSize = Math.floor(maxLength / 3);
    const firstPart = text.substring(0, partSize);
    const lastPart = text.substring(text.length - partSize);
    
    // 중간 부분에서 대표적인 라인들 선택
    const middleStart = Math.floor(lines.length * 0.4);
    const middleEnd = Math.floor(lines.length * 0.6);
    const middleLines = lines.slice(middleStart, middleEnd);
    const middlePart = middleLines.slice(0, 3).join('\n'); // 최대 3라인
    
    const summary = `${firstPart}\n\n... [${lines.length - 6} more lines] ...\n\n${middlePart}\n\n... [more content] ...\n\n${lastPart}`;
    
    return {
      summary: summary.length > maxLength ? summary.substring(0, maxLength) + '...' : summary,
      is_truncated: true,
      original_length: totalLength
    };
  }
  
  // 경로 최소화 (공통 prefix 제거)
  minimizePaths(paths: string[], basePath?: string): { minimized_paths: string[]; common_prefix: string } {
    if (paths.length === 0) {
      return { minimized_paths: [], common_prefix: '' };
    }
    
    if (paths.length === 1) {
      const path = paths[0];
      const commonPrefix = basePath || path.substring(0, path.lastIndexOf('/') + 1);
      return {
        minimized_paths: [path.replace(commonPrefix, '')],
        common_prefix: commonPrefix
      };
    }
    
    // 공통 prefix 찾기
    let commonPrefix = paths[0];
    for (let i = 1; i < paths.length; i++) {
      while (commonPrefix && !paths[i].startsWith(commonPrefix)) {
        commonPrefix = commonPrefix.substring(0, commonPrefix.lastIndexOf('/'));
      }
    }
    
    if (commonPrefix && !commonPrefix.endsWith('/')) {
      commonPrefix += '/';
    }
    
    return {
      minimized_paths: paths.map(path => path.replace(commonPrefix, '')),
      common_prefix: commonPrefix
    };
  }
  
  // 메타데이터 최소화
  minimizeMetadata(item: any): any {
    return {
      n: item.name,
      t: item.type === 'directory' ? 'd' : 'f',
      s: item.size,
      m: item.modified ? new Date(item.modified).getTime() : undefined
    };
  }
  
  // Content 참조 생성
  createContentReference(content: any, type: ContentReference['content_type'], options: CompressionOptions = {}): ContentReference {
    const contentId = `ref_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    
    // 내용을 저장소에 보관
    this.contentStore.set(contentId, content);
    
    // 미리보기 생성
    let preview = '';
    const previewSize = options.max_content_preview || this.PREVIEW_SIZE;
    
    if (type === 'text' && typeof content === 'string') {
      preview = content.length > previewSize ? 
        content.substring(0, previewSize) + '...' : content;
    } else if (type === 'directory' && Array.isArray(content)) {
      preview = `${content.length} items`;
    } else if (type === 'search_results' && Array.isArray(content)) {
      preview = `${content.length} results found`;
    }
    
    return {
      content_id: contentId,
      content_type: type,
      size: JSON.stringify(content).length,
      preview,
      fetch_url: `fetch_content/${contentId}`
    };
  }
  
  // 저장된 content 가져오기
  getStoredContent(contentId: string): any | null {
    return this.contentStore.get(contentId);
  }
  
  // 저장소 정리
  cleanup(): void {
    this.contentStore.clear();
  }
  
  // 통합 최소화 함수
  async minimizeResponse(data: any, options: CompressionOptions = {}): Promise<any> {
    const result = { ...data };
    
    // 1. 압축 처리
    if (options.enable_compression && data.content && typeof data.content === 'string') {
      const compressed = await this.compressText(data.content);
      result.content = {
        type: 'compressed',
        data: compressed.compressed,
        original_size: compressed.original_size,
        compressed_size: compressed.compressed_size,
        compression_ratio: compressed.original_size / compressed.compressed_size
      };
    }
    
    // 2. 요약 모드
    else if (options.summary_mode && data.content && typeof data.content === 'string') {
      const summary = this.summarizeText(data.content, options.max_content_preview || 1000);
      result.content = {
        type: 'summary',
        data: summary.summary,
        is_truncated: summary.is_truncated,
        original_length: summary.original_length
      };
    }
    
    // 3. 참조 모드
    else if (options.reference_mode && data.content) {
      const contentType = typeof data.content === 'string' ? 'text' : 
                         Array.isArray(data.content) ? 'search_results' : 'binary';
      result.content = this.createContentReference(data.content, contentType, options);
    }
    
    // 4. 경로 최소화 (디렉토리 리스팅)
    if (options.minimize_paths && data.items && Array.isArray(data.items)) {
      const paths = data.items.map((item: any) => item.path).filter(Boolean);
      if (paths.length > 0) {
        const minimized = this.minimizePaths(paths, data.path);
        result.items = data.items.map((item: any, index: number) => ({
          ...item,
          path: minimized.minimized_paths[index] || item.path
        }));
        result.path_info = {
          common_prefix: minimized.common_prefix,
          paths_minimized: true
        };
      }
    }
    
    // 5. 메타데이터 최소화
    if (options.minimal_metadata && data.items && Array.isArray(data.items)) {
      result.items = data.items.map((item: any) => this.minimizeMetadata(item));
      result.metadata_format = 'minimized'; // n=name, t=type, s=size, m=modified_timestamp
    }
    
    // 크기 정보 추가
    const originalSize = JSON.stringify(data).length;
    const minimizedSize = JSON.stringify(result).length;
    
    result.size_optimization = {
      original_size: originalSize,
      minimized_size: minimizedSize,
      reduction_percentage: ((originalSize - minimizedSize) / originalSize * 100).toFixed(1),
      techniques_used: Object.keys(options).filter(key => options[key as keyof CompressionOptions])
    };
    
    return result;
  }
}

// 전역 인스턴스
export const globalContentMinimizer = new ContentMinimizer();

// 압축 해제를 위한 헬퍼 함수
export async function fetchContent(contentId: string): Promise<any> {
  return globalContentMinimizer.getStoredContent(contentId);
}
