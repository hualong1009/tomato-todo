import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 18, className, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    ...props
  }
}

export function TomatoIcon({ size = 18, className, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      className={className}
      fill="none"
      {...props}
    >
      <path
        fill="currentColor"
        d="M22.494 5.344c-.687 0-1.352.066-1.991.177-.819-.104-2.74-.231-3.591-.231-8.473 0-15.886 3.177-15.886 14.298 0 9.036 7.049 16.361 16.976 16.361s17.974-7.325 17.974-16.361C35.975 8.339 26.59 5.344 22.494 5.344z"
      />
      <path
        fill="#6fcf7d"
        d="M8.439.091c1.637 1.636 2.77 2.266 3.274 4.91.298 1.564 2.266 1.51 2.266 1.51s-3.903 1.763-5.54 3.4c0 0 4.91-1.637 6.547-1.637 0 0 3.273 1.637 3.273 3.273 0 0 0-3.273-1.636-3.273 0 0 4.909 0 4.909 3.273 0 0 0-4.91-1.637-4.91 0 0 4.911-1.636 6.548 0 0 0-1.686-1.72-4.911-1.636 0 0 1.638-1.637 4.911-1.637 0 0-5.288-1.511-6.925 1.763 0 0-1.385-1.385 1.385-4.155 0 0-4.28.755-4.28 4.029 0 0-1.552-.04-2.644-1.259C11.838 1.35 8.439.091 8.439.091z"
      />
    </svg>
  )
}

export const CheckIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m5 12 4 4L19 6" />
  </svg>
)

export const PlusIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const PinIcon = ({ filled, ...props }: IconProps & { filled?: boolean }) => (
  <svg {...base(props)}>
    <path
      d="M9 4h6l-1 5 3.5 3.2a1 1 0 0 1-.68 1.8H13v6l-1 1-1-1v-6H7.18a1 1 0 0 1-.68-1.8L10 9 9 4Z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </svg>
)

export const TimerIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 9.5v4.2l2.6 1.6M9.5 2.8h5M12 2.8v2.5" />
  </svg>
)

export const PlayIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" stroke="none" />
  </svg>
)

export const PauseIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none" />
  </svg>
)

export const ResetIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4.5 9A8 8 0 1 1 5 16" />
    <path d="M4.5 4.5V9H9" />
  </svg>
)

export const SkipIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 5.5 15 12 6 18.5v-13ZM18 5v14" />
  </svg>
)

export const SettingsIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-2.87 2.87-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4.06v-.04A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06-2.87-2.87.06-.06A1.7 1.7 0 0 0 4.5 15a1.7 1.7 0 0 0-1.56-1.03H3v-4.06h.04A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06 2.87-2.87.06.06A1.7 1.7 0 0 0 9 4.5a1.7 1.7 0 0 0 1.03-1.56V3h4.06v.04A1.7 1.7 0 0 0 15.1 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06 2.87 2.87-.06.06A1.7 1.7 0 0 0 19.5 9a1.7 1.7 0 0 0 1.56 1.03H21v4.06h-.04A1.7 1.7 0 0 0 19.4 15Z" />
  </svg>
)

export const SparklesIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m12 3 1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7L12 3Z" />
    <path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
  </svg>
)

export const XIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const MinusIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M5 12h14" />
  </svg>
)

export const SquareIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
)

export const ArchiveIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="3.5" y="4" width="17" height="4.5" rx="1.2" />
    <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M9.5 12.5h5" />
  </svg>
)

export const TrashIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 7h16M9 7V4.5h6V7M7 7l.8 13h8.4L17 7M10 11v5M14 11v5" />
  </svg>
)

export const SearchIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m16 16 4.2 4.2" />
  </svg>
)

export const InboxIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 13.5 6.4 5h11.2L20 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5.5Z" />
    <path d="M4 13.5h5l1.2 2h3.6l1.2-2h5" />
  </svg>
)

export const FolderIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h4l2 2.2h7.6a1.7 1.7 0 0 1 1.7 1.7v7.9a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V7.2Z" />
  </svg>
)

export const MoreIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </svg>
)

export const CalendarIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
    <path d="M8 3.5v4M16 3.5v4M4 9.5h16" />
  </svg>
)

export const FlameIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12.2 3.2c.8 3-1.9 4.4-1.9 6.7 0 1 .7 1.9 1.6 1.9 1.4 0 2.3-1.3 2.3-2.8 1.5 1.3 2.7 3.3 2.7 5.7A5.6 5.6 0 0 1 11.4 20a5.7 5.7 0 0 1-5.7-5.8c0-3.9 3.1-6 6.5-11Z" />
  </svg>
)

export const AlertIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 4 21 20H3L12 4Z" />
    <path d="M12 9v5M12 17.3v.2" />
  </svg>
)

export const LayersIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m12 3.5 8.5 4.7L12 13 3.5 8.2 12 3.5Z" />
    <path d="m4 12.2 8 4.4 8-4.4M4 16.2l8 4.4 8-4.4" />
  </svg>
)

export const ClockIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="8.2" />
    <path d="M12 7.2V12l3.2 2" />
  </svg>
)

export const CloudIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M7.3 18.2h9.8a3.5 3.5 0 0 0 .4-7 5.5 5.5 0 0 0-10.6-1.3 4.2 4.2 0 0 0 .4 8.3Z" />
  </svg>
)

export const CloudCheckIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M7.3 18.2h9.8a3.5 3.5 0 0 0 .4-7 5.5 5.5 0 0 0-10.6-1.3 4.2 4.2 0 0 0 .4 8.3Z" />
    <path d="m9.5 13.6 1.7 1.7 3.4-3.5" />
  </svg>
)

export const CloudOffIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M7.3 18.2h9.8a3.5 3.5 0 0 0 .4-7 5.5 5.5 0 0 0-10.6-1.3 4.2 4.2 0 0 0 .4 8.3Z" />
    <path d="m4 4 16 16" />
  </svg>
)

export const CopyIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="8" y="8" width="11.5" height="11.5" rx="2" />
    <path d="M16 8V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5v9a1.5 1.5 0 0 0 1.5 1.5H8" />
  </svg>
)

export const PencilIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M16.9 3.9a2.2 2.2 0 0 1 3.2 3.2L8.1 19.1l-4.2 1 1-4.2L16.9 3.9Z" />
  </svg>
)

export const EyeIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M2.8 12S6.3 5.8 12 5.8 21.2 12 21.2 12 17.7 18.2 12 18.2 2.8 12 2.8 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </svg>
)

export const EyeOffIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 4.5 20 20.5M9.9 6.2A9.7 9.7 0 0 1 12 6c5.7 0 9.2 6 9.2 6a16.7 16.7 0 0 1-3.1 3.7M6.6 7.7A16 16 0 0 0 2.8 12S6.3 18 12 18a9.8 9.8 0 0 0 4.2-.9M9.9 10a3 3 0 0 0 4.2 4.2" />
  </svg>
)

export const PaletteIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 3.3a8.7 8.7 0 1 0 0 17.4h1.2a1.7 1.7 0 0 0 .5-3.3 1.7 1.7 0 0 1 .5-3.3h1.6a4.9 4.9 0 0 0 4.9-4.9c0-3.3-3.9-5.9-8.7-5.9Z" />
    <circle cx="7.7" cy="10.1" r="1" fill="currentColor" stroke="none" />
    <circle cx="10.1" cy="6.8" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.3" cy="6.9" r="1" fill="currentColor" stroke="none" />
    <circle cx="17.1" cy="9.8" r="1" fill="currentColor" stroke="none" />
  </svg>
)

export const ExternalIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M14 4h6v6M20 4l-8.5 8.5" />
    <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </svg>
)

export const ChevronDownIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const ChevronRightIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const CoffeeIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4.5 8h11v5.2a4.2 4.2 0 0 1-4.2 4.2H8.7a4.2 4.2 0 0 1-4.2-4.2V8Z" />
    <path d="M15.5 9h1.7a2.6 2.6 0 0 1 0 5.2h-1.7M6 4.5c0-1 1-1 1-2M10 4.5c0-1 1-1 1-2M14 4.5c0-1 1-1 1-2M3.5 20.5h14" />
  </svg>
)

export const StarIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8L12 3.8Z" />
  </svg>
)

export const MoonIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M20 14.5A8.2 8.2 0 0 1 9.5 4a8.2 8.2 0 1 0 10.5 10.5Z" />
  </svg>
)

export const SunIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6" />
  </svg>
)

export const SystemIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="2.5" y="4" width="19" height="13" rx="2" />
    <path d="M8.5 21h7M12 17.5V21" />
  </svg>
)

export const LockIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.2" r="1.2" />
  </svg>
)

export const MenuIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

export const BoldIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h6.5a3.5 3.5 0 0 1 0 7H7z" />
  </svg>
)

export const ItalicIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M15 5h-5M14 19H9M14 5l-4 14" />
  </svg>
)

export const StrikeIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 12h12" />
    <path d="M15.5 8.5c0-1.7-1.6-3-3.6-3s-3.4 1-3.4 2.6c0 1.3 1 2.1 2.6 2.9M8.4 15.6c0 1.8 1.7 3 3.7 3s3.5-1.1 3.5-2.8" />
  </svg>
)

export const HeadingIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 5v14M14 5v14M6 12h8" />
  </svg>
)

export const ListIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.6" cy="6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="4.6" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="4.6" cy="18" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)

export const QuoteIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2" />
    <path d="M19 7h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2" />
  </svg>
)

export const CodeIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
  </svg>
)

export const ImageIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4.5 17.5l4.6-4.4 3.2 3 2.6-2.3 4.6 4" />
  </svg>
)

export const LinkIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.4 1.4" />
    <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.4-1.4" />
  </svg>
)

export const DownloadIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 4v10m0 0l-4-4m4 4l4-4" />
    <path d="M5 17.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-1.5" />
  </svg>
)

export const PaperclipIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9.5 14.5 15 9a2.5 2.5 0 0 1 3.5 3.5l-6.4 6.4a4.5 4.5 0 0 1-6.4-6.4l6.6-6.6a3 3 0 0 1 4.2 4.2l-6.4 6.4a1.5 1.5 0 0 1-2.1-2.1l5.4-5.4" />
  </svg>
)

export const UploadIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 20V10m0 0l-4 4m4-4l4 4" />
    <path d="M5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 19 5v1.5" />
  </svg>
)

export const FileTextIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5z" />
    <path d="M14 3.5V7.5H18M9 12h6M9 16h4" />
  </svg>
)
