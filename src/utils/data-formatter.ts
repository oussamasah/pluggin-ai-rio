
export class DataFormatter {
    formatCurrency(amount: number, currency: string = 'USD'): string {
      if (!amount) return 'N/A';
      
      const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
  
      return formatter.format(amount);
    }
  
    formatLargeNumber(num: number): string {
      if (!num) return 'N/A';
      
      if (num >= 1000000000) {
        return `${(num / 1000000000).toFixed(1)}B`;
      } else if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M`;
      } else if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}K`;
      }
      
      return num.toString();
    }
  
    formatDate(date: Date | string): string {
      if (!date) return 'N/A';
      
      const d = typeof date === 'string' ? new Date(date) : date;
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
  
    truncateText(text: string, maxLength: number = 100): string {
      if (!text || text.length <= maxLength) return text;
      return text.substring(0, maxLength - 3) + '...';
    }
  
    formatPercentage(value: number): string {
      if (value === null || value === undefined) return 'N/A';
      return `${(value * 100).toFixed(1)}%`;
    }
  
    formatConfidenceLevel(confidence: number): string {
      if (confidence >= 0.9) return '🟢 Very High';
      if (confidence >= 0.7) return '🟡 High';
      if (confidence >= 0.5) return '🟠 Medium';
      return '🔴 Low';
    }
  
    sanitizeForMarkdown(text: string): string {
      return text
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  
    createMarkdownTable(
      data: any[],
      columns: { key: string; label: string; format?: (val: any) => string }[]
    ): string {
      if (data.length === 0) return '_No data available_';
  
      let table = '| ' + columns.map(c => c.label).join(' | ') + ' |\n';
      table += '|' + columns.map(() => '---').join('|') + '|\n';
  
      data.forEach(row => {
        table += '| ';
        table += columns.map(col => {
          const value = this.getNestedValue(row, col.key);
          const formatted = col.format ? col.format(value) : 
            (value !== null && value !== undefined ? String(value) : 'N/A');
          return this.sanitizeForMarkdown(formatted);
        }).join(' | ');
        table += ' |\n';
      });
  
      return table;
    }
  
    private getNestedValue(obj: any, path: string): any {
      return path.split('.').reduce((acc, part) => acc?.[part], obj);
    }
  }
  
  export const dataFormatter = new DataFormatter();
  