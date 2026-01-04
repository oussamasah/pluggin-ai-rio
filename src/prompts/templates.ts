
export const RESPONSE_TEMPLATES = {
    COMPANY_LIST: (companies: any[]) => {
      let markdown = '## Companies Matching Your Criteria\n\n';
      
      markdown += '| Name | Industry | Revenue | Employees | Location |\n';
      markdown += '|------|----------|---------|-----------|----------|\n';
      
      companies.forEach(company => {
        markdown += `| ${company.name} | ${company.industry?.join(', ') || 'N/A'} | `;
        markdown += `$${company.annualRevenue ? (company.annualRevenue / 1000000).toFixed(1) + 'M' : 'N/A'} | `;
        markdown += `${company.employeeCount || 'N/A'} | `;
        markdown += `${company.city || 'N/A'}, ${company.country || 'N/A'} |\n`;
      });
  
      markdown += `\n**Total Results:** ${companies.length} companies\n`;
      return markdown;
    },
  
    EMPLOYEE_LIST: (employees: any[]) => {
      let markdown = '## Employees\n\n';
      
      markdown += '| Name | Title | Company | Decision Maker | Contact |\n';
      markdown += '|------|-------|---------|----------------|----------|\n';
      
      employees.forEach(emp => {
        markdown += `| ${emp.fullName} | ${emp.activeExperienceTitle || emp.headline || 'N/A'} | `;
        markdown += `${emp.company?.company_name || 'N/A'} | `;
        markdown += `${emp.isDecisionMaker ? '✓' : '✗'} | `;
        markdown += `${emp.primaryProfessionalEmail || 'N/A'} |\n`;
      });
  
      markdown += `\n**Total Results:** ${employees.length} employees\n`;
      return markdown;
    },
  
    ICP_FIT_ANALYSIS: (company: any, icpModel: any, fitScore: number) => {
      return `## ICP Fit Analysis: ${company.name}
  
  ### Fit Score: ${(fitScore * 100).toFixed(1)}%
  
  ### Company Profile
  - **Industry:** ${company.industry?.join(', ') || 'N/A'}
  - **Revenue:** $${company.annualRevenue ? (company.annualRevenue / 1000000).toFixed(1) + 'M' : 'N/A'}
  - **Employees:** ${company.employeeCount || 'N/A'}
  - **Technologies:** ${company.technologies?.join(', ') || 'N/A'}
  
  ### ICP Model: ${icpModel.name}
  ${icpModel.config?.productDescription ? `**Product:** ${icpModel.config.productDescription}\n` : ''}
  ${icpModel.config?.targetIndustry ? `**Target Industry:** ${icpModel.config.targetIndustry.join(', ')}\n` : ''}
  
  ### Fit Analysis
  ${fitScore > 0.8 ? '🟢 **Excellent Fit** - This company strongly matches your ICP criteria.' :
    fitScore > 0.6 ? '🟡 **Good Fit** - This company matches many ICP criteria.' :
    fitScore > 0.4 ? '🟠 **Moderate Fit** - This company has some alignment with your ICP.' :
    '🔴 **Low Fit** - This company has limited alignment with your ICP.'}`;
    },
  
    ERROR_RESPONSE: (error: string, suggestions: string[]) => {
      return `## ⚠️ Unable to Complete Request
  
  ${error}
  
  ### What I can help with instead:
  ${suggestions.map(s => `- ${s}`).join('\n')}
  
  Please try rephrasing your request or let me know which option you'd prefer.`;
    },
  
    ACTION_CONFIRMATION: (actions: any[]) => {
      let markdown = '## ⚡ Action Confirmation Required\n\n';
      markdown += 'I\'m ready to execute the following actions:\n\n';
      
      actions.forEach((action, idx) => {
        markdown += `${idx + 1}. **${action.tool}**: ${action.action}\n`;
        markdown += `   Parameters: ${JSON.stringify(action.parameters, null, 2)}\n\n`;
      });
  
      markdown += '**Reply with "confirm" to proceed or "cancel" to abort.**';
      return markdown;
    }
  };
  
  export const formatDataTable = (
    data: any[],
    columns: { key: string; label: string }[]
  ): string => {
    let markdown = '| ' + columns.map(c => c.label).join(' | ') + ' |\n';
    markdown += '|' + columns.map(() => '------').join('|') + '|\n';
    
    data.forEach(row => {
      markdown += '| ';
      markdown += columns.map(col => {
        const value = row[col.key];
        return value !== null && value !== undefined ? String(value) : 'N/A';
      }).join(' | ');
      markdown += ' |\n';
    });
  
    return markdown;
  };