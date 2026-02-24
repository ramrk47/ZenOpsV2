import React from 'react'

export default function DataTable({
  loading = false,
  columns = 6,
  rows = 6,
  className = '',
  minWidth,
  children,
}) {
  if (loading) {
    const cols = Array.from({ length: columns }, (_, idx) => idx)
    const rowList = Array.from({ length: rows }, (_, idx) => idx)
    return (
      <div className={`table-wrap ${className}`.trim()}>
        <table className="table-skeleton" style={minWidth ? { minWidth } : undefined}>
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={`sk-head-${col}`}>
                  <div className="skeleton-line" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowList.map((row) => (
              <tr key={`sk-row-${row}`}>
                {cols.map((col) => (
                  <td key={`sk-cell-${row}-${col}`}>
                    <div className={`skeleton-line ${col % 2 === 0 ? 'short' : ''}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className={`table-wrap ${className}`.trim()}>
      {children}
    </div>
  )
}
