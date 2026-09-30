"use client"

import { useRef, useState } from "react"
import {
  AlertTriangle,
  Bold,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  FlaskConical,
  GraduationCap,
  Info,
  Italic,
  LayoutGrid,
  Map as MapIcon,
  MoreHorizontal,
  Play,
  Plus,
  Redo2,
  Search,
  Settings,
  Square,
  Trash2,
  Truck,
  Underline,
  Undo2,
} from "lucide-react"

import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardPanel, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { CheckboxGroup } from "@/components/ui/checkbox-group"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup } from "@/components/ui/combobox"
import { ContextMenu, ContextMenuItem, ContextMenuPopup, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Drawer, DrawerDescription, DrawerHeader, DrawerPopup, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Fieldset, FieldsetLegend } from "@/components/ui/fieldset"
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/ui/frame"
import { Group as ButtonGroup, GroupSeparator } from "@/components/ui/group"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@/components/ui/menu"
import { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue } from "@/components/ui/meter"
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@/components/ui/number-field"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Popover, PopoverDescription, PopoverPopup, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "@/components/ui/preview-card"
import { Progress } from "@/components/ui/progress"
import { Radio, RadioGroup } from "@/components/ui/radio-group"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetDescription, SheetHeader, SheetPanel, SheetPopup, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { anchoredToastManager, toastManager } from "@/components/ui/toast"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator } from "@/components/ui/toolbar"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"

import { Group, Row, Specimen } from "../specimen"

const vehicleTypes = ["53 ft dry van", "53 ft reefer", "48 ft flatbed", "26 ft box truck"]
const travelModes = [
  { value: "haversine", label: "Haversine × circuity (estimated)" },
  { value: "osrm", label: "OSRM road network" },
  { value: "imported", label: "Imported matrix" },
]
const objectives = [
  ["fill", "Truck fill"],
  ["tightness", "Cluster tightness"],
  ["revenue", "Revenue"],
] as const

export function Primitives({ onOpenCommand }: { onOpenCommand: () => void }) {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 8, 29))
  const [budget, setBudget] = useState(10)
  const [solving, setSolving] = useState(false)
  const copyRef = useRef<HTMLButtonElement>(null)

  return (
    <Group
      id="primitives"
      index={2}
      title="Primitives"
      description="Vendored coss ui components (Base UI) in src/components/ui. Customize through tokens and composition, not by editing the files."
    >
      <Specimen id="actions" title="Actions" source="button · group · toggle · toggle-group · badge · kbd · avatar">
        <div className="space-y-6">
          <Row label="Variants">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="destructive-outline">Destructive outline</Button>
            <Button variant="link">Link</Button>
          </Row>
          <Row label="Sizes & states">
            <Button size="xs">XS</Button>
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Add">
              <Plus />
            </Button>
            <Button disabled>Disabled</Button>
            <Button
              onClick={() => {
                setSolving(true)
                setTimeout(() => setSolving(false), 2000)
              }}
              disabled={solving}
            >
              {solving ? <Spinner /> : <Play />}
              {solving ? "Running…" : "Run pipeline"}
            </Button>
            <Button variant="outline" disabled={!solving}>
              <Square /> Cancel
            </Button>
          </Row>
          <Row label="Groups & toggles">
            <ToggleGroup defaultValue={["10"]} variant="outline">
              <ToggleGroupItem value="5">5 s</ToggleGroupItem>
              <ToggleGroupItem value="10">10 s</ToggleGroupItem>
              <ToggleGroupItem value="30">30 s</ToggleGroupItem>
              <ToggleGroupItem value="120">120 s</ToggleGroupItem>
            </ToggleGroup>
            <ButtonGroup aria-label="Export">
              <Button variant="outline">
                <Download /> Export
              </Button>
              <Button variant="outline" size="icon" aria-label="More export options">
                <ChevronDown />
              </Button>
            </ButtonGroup>
            <ButtonGroup aria-label="Run">
              <Button>
                <Play /> Run pipeline
              </Button>
              <GroupSeparator />
              <Button size="icon" aria-label="Run options">
                <ChevronDown />
              </Button>
            </ButtonGroup>
            <Toggle aria-label="Bold">
              <Bold />
            </Toggle>
            <ToggleGroup multiple variant="outline">
              <ToggleGroupItem value="bold" aria-label="Bold">
                <Bold />
              </ToggleGroupItem>
              <ToggleGroupItem value="italic" aria-label="Italic">
                <Italic />
              </ToggleGroupItem>
              <ToggleGroupItem value="underline" aria-label="Underline">
                <Underline />
              </ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup defaultValue={["mi"]} variant="outline" size="sm">
              <ToggleGroupItem value="mi">mi</ToggleGroupItem>
              <ToggleGroupItem value="km">km</ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label="Badges">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="info">Queued</Badge>
            <Badge variant="success">Non-dominated</Badge>
            <Badge variant="warning">Low fill</Badge>
            <Badge variant="error">Beyond leg limit</Badge>
            <Badge variant="outline">Best found · not proven optimal</Badge>
          </Row>
          <Row label="Kbd & avatar">
            <span className="flex items-center gap-2 text-sm">
              Command menu
              <KbdGroup>
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </KbdGroup>
            </span>
            <span className="flex items-center gap-2 text-sm">
              Run pipeline
              <KbdGroup>
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
              </KbdGroup>
            </span>
            <Avatar>
              <AvatarFallback>CB</AvatarFallback>
            </Avatar>
          </Row>
        </div>
      </Specimen>

      <Specimen
        id="forms"
        title="Form controls"
        source="field · fieldset · input · input-group · number-field · select · combobox · slider · radio-group · checkbox-group · switch · calendar"
      >
        <div className="grid gap-10 md:grid-cols-2">
          <div className="flex flex-col gap-6">
            <Field>
              <FieldLabel>Scenario name</FieldLabel>
              <Input placeholder="Mid-South open orders" />
              <FieldDescription>Shown in the scenario list and exports.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Maximum leg</FieldLabel>
              <InputGroup>
                <InputGroupInput type="number" defaultValue={500} />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>solver mi</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel>Cluster count (k)</FieldLabel>
              <NumberField defaultValue={7} min={1} max={30}>
                <NumberFieldGroup>
                  <NumberFieldDecrement />
                  <NumberFieldInput />
                  <NumberFieldIncrement />
                </NumberFieldGroup>
              </NumberField>
            </Field>
            <Field>
              <FieldLabel>Search order lines</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput placeholder="SO-260412, account, or SKU" />
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel>Notes</FieldLabel>
              <Textarea placeholder="What is this sweep testing? e.g. does k = 8 raise minimum fill?" />
            </Field>
            <Field invalid>
              <FieldLabel>Trailer length</FieldLabel>
              <Input aria-invalid defaultValue={-53} />
              <FieldError match>Trailer length must be greater than 0 ft.</FieldError>
            </Field>
          </div>

          <div className="flex flex-col gap-6">
            <Field>
              <FieldLabel>Travel mode</FieldLabel>
              <Select defaultValue="haversine" items={travelModes}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {travelModes.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Trailer type</FieldLabel>
              <Combobox items={vehicleTypes}>
                <ComboboxInput placeholder="Choose a trailer" />
                <ComboboxPopup>
                  <ComboboxEmpty>No trailers found.</ComboboxEmpty>
                  <ComboboxList>
                    {(item: string) => (
                      <ComboboxItem key={item} value={item}>
                        {item}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxPopup>
              </Combobox>
            </Field>
            <Field>
              <FieldLabel className="w-full">
                Search time per cluster <span className="text-muted-foreground ml-auto font-mono tabular-nums">{budget} s</span>
              </FieldLabel>
              <Slider className="w-full" value={budget} onValueChange={(v) => setBudget(v as number)} min={5} max={120} step={5} />
            </Field>
            <Fieldset>
              <FieldsetLegend className="text-sm">Allocation strategy</FieldsetLegend>
              <RadioGroup defaultValue="date-value">
                {[
                  ["date-value", "Order date, then value"],
                  ["first-come", "First come"],
                  ["priority", "Priority"],
                  ["proportional", "Proportional"],
                  ["optimized", "Optimized"],
                ].map(([value, label]) => (
                  <Label key={value}>
                    <Radio value={value} /> {label}
                  </Label>
                ))}
              </RadioGroup>
            </Fieldset>
            <Fieldset>
              <FieldsetLegend className="text-sm">Compare runs on</FieldsetLegend>
              <CheckboxGroup defaultValue={["fill", "tightness", "revenue"]}>
                {objectives.map(([value, label]) => (
                  <Label key={value}>
                    <Checkbox value={value} /> {label}
                  </Label>
                ))}
              </CheckboxGroup>
            </Fieldset>
            <Label>
              <Checkbox defaultChecked /> Allow ZIP/ZCTA fallback with review warning
            </Label>
            <Label>
              <Switch /> Partial fills (piece-level allocation)
            </Label>
          </div>
        </div>
        <Row label="Calendar" className="mt-8">
          <Calendar mode="single" selected={date} onSelect={setDate} className="bg-card rounded-xl border" />
        </Row>
      </Specimen>

      <Specimen
        id="overlays"
        title="Overlays & menus"
        source="dialog · alert-dialog · sheet · drawer · popover · tooltip · preview-card · menu · context-menu · command · toast"
      >
        <div className="space-y-6">
          <Row label="Triggers">
            <Dialog>
              <DialogTrigger render={<Button variant="outline" />}>Dialog</DialogTrigger>
              <DialogPopup className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Your name</DialogTitle>
                  <DialogDescription>Recorded on saved versions and runs. It is a label, not authentication.</DialogDescription>
                </DialogHeader>
                <DialogPanel>
                  <Field>
                    <FieldLabel>Display name</FieldLabel>
                    <Input placeholder="Display name" />
                  </Field>
                </DialogPanel>
                <DialogFooter>
                  <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
                  <DialogClose render={<Button />}>Continue</DialogClose>
                </DialogFooter>
              </DialogPopup>
            </Dialog>

            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="outline" />}>Version conflict</AlertDialogTrigger>
              <AlertDialogPopup>
                <AlertDialogHeader>
                  <AlertDialogTitle>Someone saved a newer version</AlertDialogTitle>
                  <AlertDialogDescription>Your edits started from version 12; the latest is 13.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="ghost" />}>Discard and reload</AlertDialogClose>
                  <AlertDialogClose render={<Button />}>Save as new branch</AlertDialogClose>
                </AlertDialogFooter>
              </AlertDialogPopup>
            </AlertDialog>

            <Sheet>
              <SheetTrigger render={<Button variant="outline" />}>Sheet</SheetTrigger>
              <SheetPopup>
                <SheetHeader>
                  <SheetTitle>Cluster 3 · Memphis, TN + 11 more</SheetTitle>
                  <SheetDescription>Inspector drawer used below tablet widths.</SheetDescription>
                </SheetHeader>
                <SheetPanel className="text-muted-foreground text-sm">82 stops · 22 trucks · 80% average fill.</SheetPanel>
              </SheetPopup>
            </Sheet>

            <Drawer>
              <DrawerTrigger render={<Button variant="outline" />}>Drawer</DrawerTrigger>
              <DrawerPopup showBar>
                <DrawerHeader>
                  <DrawerTitle>C3-T4 · 94% full</DrawerTitle>
                  <DrawerDescription>Mobile results drawer: one truck&apos;s stops and lines.</DrawerDescription>
                </DrawerHeader>
              </DrawerPopup>
            </Drawer>

            <Popover>
              <PopoverTrigger render={<Button variant="outline" />}>Popover</PopoverTrigger>
              <PopoverPopup className="w-72">
                <PopoverTitle className="text-sm">Circuity factor</PopoverTitle>
                <PopoverDescription className="mt-1">
                  Haversine miles × 1.2 approximate road miles. Units: multiplier. Setting: <code>travel.circuity_factor</code>.
                </PopoverDescription>
              </PopoverPopup>
            </Popover>

            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" />}>Tooltip</TooltipTrigger>
              <TooltipPopup>Straight-line schematic, not road geometry</TooltipPopup>
            </Tooltip>

            <PreviewCard>
              <PreviewCardTrigger render={<Button variant="link" />}>run-0214</PreviewCardTrigger>
              <PreviewCardPopup className="space-y-1 text-sm">
                <div className="font-medium">k = 8 · 154 trucks · 83% avg fill</div>
                <div className="text-muted-foreground font-mono text-xs">PyVRP 0.14.0 · seed 0 · 10 s/cluster · haversine × 1.2</div>
              </PreviewCardPopup>
            </PreviewCard>

            <Menu>
              <MenuTrigger render={<Button variant="outline" />}>
                Export <ChevronDown />
              </MenuTrigger>
              <MenuPopup align="start">
                <MenuGroup>
                  <MenuGroupLabel>Export as</MenuGroupLabel>
                  <MenuItem>
                    Scenario JSON <MenuShortcut>⌘E</MenuShortcut>
                  </MenuItem>
                  <MenuItem>Truck loads (CSV)</MenuItem>
                  <MenuItem>Unshipped lines (CSV)</MenuItem>
                  <MenuItem>GeoJSON</MenuItem>
                  <MenuItem>Python bundle</MenuItem>
                </MenuGroup>
              </MenuPopup>
            </Menu>

            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="icon" aria-label="Run actions" />}>
                <MoreHorizontal />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem>
                  <Copy /> Duplicate as branch
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive">
                  <Trash2 /> Delete run
                </MenuItem>
              </MenuPopup>
            </Menu>
          </Row>

          <Row label="Toasts">
            <Button
              variant="outline"
              onClick={() => toastManager.add({ type: "success", title: "Pipeline run queued", description: "run-0221 · k auto · 10 s per cluster" })}
            >
              Success
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toastManager.add({ type: "info", title: "Clusters reused", description: "Same stops and k as run-0214; skipping k-means." })
              }
            >
              Info
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toastManager.add({ type: "warning", title: "29 stops beyond the 500 mi leg limit", description: "They will be allocated but not loaded." })
              }
            >
              Warning
            </Button>
            <Button
              variant="outline"
              onClick={() => toastManager.add({ type: "error", title: "Cluster 5 solve failed", description: "Exceeded the 300 s solve limit after 3 attempts." })}
            >
              Error
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toastManager.promise(new Promise((r) => setTimeout(r, 1800)), {
                  loading: { title: "Geocoding 640 addresses…", description: "Census batch 1 of 1" },
                  success: { title: "Addresses geocoded", description: "551 Census · 29 ZCTA · 6 unresolved" },
                  error: { title: "Geocoding failed" },
                })
              }
            >
              Promise
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const id = toastManager.add({
                  type: "success",
                  title: "Moved Acct 40451 on the map",
                  description: "Saved as an unsaved edit.",
                  actionProps: {
                    children: "Undo",
                    onClick: () => {
                      toastManager.close(id)
                      toastManager.add({ type: "info", title: "Coordinates restored" })
                    },
                  },
                })
              }}
            >
              With action
            </Button>
            <Button
              ref={copyRef}
              variant="outline"
              onClick={() =>
                anchoredToastManager.add({
                  title: "Copied run-0214",
                  data: { tooltipStyle: true },
                  positionerProps: { anchor: copyRef.current, side: "top" },
                  timeout: 1500,
                })
              }
            >
              <Copy /> Copy run ID
            </Button>
          </Row>

          <div className="grid gap-6 md:grid-cols-2">
            <Row label="Context menu">
              <ContextMenu>
                <ContextMenuTrigger className="text-muted-foreground bg-background flex h-40 w-full items-center justify-center rounded-xl border border-dashed text-sm">
                  Right-click a stop on the map
                </ContextMenuTrigger>
                <ContextMenuPopup>
                  <ContextMenuItem>Show order lines</ContextMenuItem>
                  <ContextMenuItem>Correct coordinates</ContextMenuItem>
                  <ContextMenuItem>Open truck C3-T4</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive">Exclude from this run</ContextMenuItem>
                </ContextMenuPopup>
              </ContextMenu>
            </Row>
            <Row label="Command">
              <div className="bg-background flex h-40 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-sm">
                <span className="text-muted-foreground">This gallery&apos;s jump menu is a CommandDialog.</span>
                <Button variant="outline" onClick={onOpenCommand}>
                  <Search /> Open command menu
                  <KbdGroup>
                    <Kbd>⌘</Kbd>
                    <Kbd>K</Kbd>
                  </KbdGroup>
                </Button>
              </div>
            </Row>
          </div>
        </div>
      </Specimen>

      <Specimen id="navigation" title="Navigation" source="sidebar · tabs · breadcrumb · toolbar · pagination">
        <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
          <SidebarProvider className="min-h-0 w-auto">
            <Sidebar collapsible="none" className="h-72 w-full rounded-xl border">
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupLabel>Fillrate</SidebarGroupLabel>
                  <SidebarMenu>
                    {(
                      [
                        [LayoutGrid, "Scenarios", 12],
                        [MapIcon, "Workbench", null],
                        [FlaskConical, "Experiments", 3],
                        [GraduationCap, "Learn", null],
                        [Settings, "Settings", null],
                      ] as const
                    ).map(([Icon, label, badge], i) => (
                      <SidebarMenuItem key={label}>
                        <SidebarMenuButton isActive={i === 1}>
                          <Icon /> {label}
                        </SidebarMenuButton>
                        {badge && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroup>
              </SidebarContent>
            </Sidebar>
          </SidebarProvider>

          <div className="min-w-0 space-y-6">
            <Row label="Breadcrumb">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink href="#">Scenarios</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink href="#">Mid-South open orders</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>run-0214</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </Row>
            <Row label="Toolbar">
              <Toolbar>
                <ToolbarGroup>
                  <Tooltip>
                    <TooltipTrigger render={<ToolbarButton aria-label="Undo" render={<Button size="icon" variant="ghost" />} />}>
                      <Undo2 />
                    </TooltipTrigger>
                    <TooltipPopup sideOffset={8}>Undo</TooltipPopup>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger render={<ToolbarButton aria-label="Redo" render={<Button size="icon" variant="ghost" />} />}>
                      <Redo2 />
                    </TooltipTrigger>
                    <TooltipPopup sideOffset={8}>Redo</TooltipPopup>
                  </Tooltip>
                </ToolbarGroup>
                <ToolbarSeparator />
                <ToolbarGroup>
                  <Menu>
                    <MenuTrigger render={<ToolbarButton render={<Button variant="ghost" />} />}>
                      Scenario <ChevronDown />
                    </MenuTrigger>
                    <MenuPopup align="start">
                      <MenuItem>
                        New… <MenuShortcut>⌘N</MenuShortcut>
                      </MenuItem>
                      <MenuItem>Duplicate</MenuItem>
                    </MenuPopup>
                  </Menu>
                </ToolbarGroup>
                <ToolbarSeparator />
                <ToolbarGroup>
                  <ToolbarButton render={<Button size="sm" />}>
                    <Play /> Run pipeline
                  </ToolbarButton>
                </ToolbarGroup>
              </Toolbar>
            </Row>
            <Row label="Workbench sections">
              <Tabs defaultValue="cluster" className="w-full">
                <TabsList>
                  {["Data", "Inventory", "Fleet", "Constraints", "Travel", "Allocate", "Cluster", "Solve", "Results"].map((t) => (
                    <TabsTab key={t} value={t.toLowerCase()}>
                      {t}
                    </TabsTab>
                  ))}
                </TabsList>
                <TabsPanel value="cluster" className="text-muted-foreground p-2 text-sm">
                  k explorer and clustering settings.
                </TabsPanel>
              </Tabs>
            </Row>
            <Row label="Underline tabs">
              <Tabs defaultValue="map">
                <TabsList variant="underline">
                  <TabsTab value="map">Clusters & trucks</TabsTab>
                  <TabsTab value="table">Unshipped</TabsTab>
                  <TabsTab value="timeline">Map</TabsTab>
                </TabsList>
              </Tabs>
            </Row>
            <Row label="Pagination">
              <Pagination className="mx-0 w-auto">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious href="#" />
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#" isActive>
                      1
                    </PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationLink href="#">2</PaginationLink>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext href="#" />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </Row>
          </div>
        </div>
      </Specimen>

      <Specimen id="display" title="Data display" source="card · frame · meter · accordion · collapsible · scroll-area">
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardDescription>Loaded miles</CardDescription>
                <CardTitle className="text-2xl tabular-nums">55,945 mi</CardTitle>
                <CardAction>
                  <Badge variant="outline">× 1.2 est.</Badge>
                </CardAction>
              </CardHeader>
              <CardFooter className="text-muted-foreground text-xs">158 trucks · open routes</CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Validation</CardDescription>
                <CardTitle className="text-2xl">All trucks pass</CardTitle>
              </CardHeader>
              <CardFooter className="text-muted-foreground text-xs">Load, leg, and diameter checks · best found, not proven optimal</CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Allocated amount shipped</CardDescription>
                <CardTitle className="text-2xl tabular-nums">93%</CardTitle>
              </CardHeader>
              <CardPanel>
                <Meter value={93}>
                  <div className="flex items-center justify-between gap-2">
                    <MeterLabel className="text-muted-foreground text-xs">$4.21M of $4.51M</MeterLabel>
                    <MeterValue className="text-xs" />
                  </div>
                  <MeterTrack>
                    <MeterIndicator />
                  </MeterTrack>
                </Meter>
              </CardPanel>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <Frame>
                <FrameHeader>
                  <FrameTitle>Fleet</FrameTitle>
                  <FrameDescription>1 trailer type · unlimited count</FrameDescription>
                </FrameHeader>
                {[
                  ["53 ft dry van", "53.0 linear ft · open route · $850 fixed per truck · Memphis DC"],
                  ["Limits", "500 mi max leg · 500 mi max cluster diameter · solver miles"],
                ].map(([title, description]) => (
                  <FramePanel key={title} className="flex items-center gap-3">
                    <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
                      <Truck className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{title}</div>
                      <div className="text-muted-foreground truncate text-sm">{description}</div>
                    </div>
                    <Button size="sm" variant="outline">
                      Edit
                    </Button>
                  </FramePanel>
                ))}
              </Frame>
              <Collapsible className="bg-card rounded-xl border p-2">
                <CollapsibleTrigger render={<Button variant="ghost" size="sm" />} className="data-panel-open:[&_svg]:rotate-180">
                  Advanced PyVRP parameters
                  <ChevronDown className="transition-transform" />
                </CollapsibleTrigger>
                <CollapsiblePanel className="text-muted-foreground px-3 pt-2 pb-1 text-sm">
                  Derived from the capabilities document; never invented in the UI.
                </CollapsiblePanel>
              </Collapsible>
            </div>
            <div className="space-y-3">
              <Accordion className="bg-card rounded-xl border px-4">
                <AccordionItem value="what">
                  <AccordionTrigger>Why does a line say “no stock”?</AccordionTrigger>
                  <AccordionPanel className="text-muted-foreground">
                    Older orders, then higher value per piece, got the SKU first. The unshipped list names the lines that took it.
                  </AccordionPanel>
                </AccordionItem>
                <AccordionItem value="field">
                  <AccordionTrigger>How is the leg limit enforced?</AccordionTrigger>
                  <AccordionPanel className="text-muted-foreground">
                    Preprocessing: legs over 500 solver miles are removed from the matrix PyVRP sees, and the validator re-checks every truck.
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>
              <ScrollArea className="bg-card h-32 rounded-xl border text-sm">
                <div className="p-3">
                  {Array.from({ length: 20 }, (_, i) => (
                    <div key={i} className="py-0.5 font-mono text-xs">
                      job_event #{i + 1} · solve C{(i % 6) + 1} · {i * 5}%
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </Specimen>

      <Specimen id="feedback" title="Feedback" source="alert · progress · spinner · skeleton · empty">
        <div className="space-y-6">
          {/* content-start keeps title/description tight when an alert stretches to its row's height */}
          <div className="grid gap-3 *:content-start md:grid-cols-2">
            <Alert className="md:col-span-2">
              <Info />
              <AlertTitle>Estimated miles</AlertTitle>
              <AlertDescription>Haversine × 1.2 circuity. Limits and loaded miles use these solver miles, not road distance.</AlertDescription>
              <AlertAction>
                <Button size="xs" variant="ghost">
                  Dismiss
                </Button>
                <Button size="xs">Travel settings</Button>
              </AlertAction>
            </Alert>
            <Alert variant="info">
              <Info />
              <AlertTitle>Pipeline running</AlertTitle>
              <AlertDescription>Solving cluster 4 of 6. You can close this tab; the run continues.</AlertDescription>
            </Alert>
            <Alert variant="success">
              <CircleCheck />
              <AlertTitle>Every truck passes validation</AlertTitle>
              <AlertDescription>158 trucks within 53 ft, no leg over 500 mi, every cluster within 500 mi.</AlertDescription>
            </Alert>
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>29 stops use approximate coordinates</AlertTitle>
              <AlertDescription>ZIP/ZCTA fallback was used. Review before running.</AlertDescription>
            </Alert>
            <Alert variant="error">
              <CircleAlert />
              <AlertTitle>Cluster 5 solve failed</AlertTitle>
              <AlertDescription>Exceeded the 300 s solve limit. Clusters 1–4 and 6 are kept; the run is marked failed.</AlertDescription>
              <AlertAction>
                <Button size="xs" variant="outline">
                  Show on map
                </Button>
              </AlertAction>
            </Alert>
          </div>
          <Row label="Loading">
            <Progress value={40} className="w-48" />
            <Spinner />
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </Row>
          <Empty className="bg-background border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FlaskConical />
              </EmptyMedia>
              <EmptyTitle>No runs yet</EmptyTitle>
              <EmptyDescription>Run the pipeline to see clusters, truck loads, and why lines didn&apos;t ship.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button>
                <Play /> Run pipeline
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      </Specimen>

      <Specimen id="layout" title="Layout" source="resizable · separator" spec="§4" description="Map + inspector + bottom table/results. Drag the handles.">
        <div className="bg-background h-80 overflow-hidden rounded-xl border">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="70%">
              <ResizablePanelGroup orientation="vertical">
                <ResizablePanel defaultSize="65%">
                  <div className="bg-muted/40 text-muted-foreground flex h-full items-center justify-center text-sm">Map</div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="35%">
                  <div className="text-muted-foreground flex h-full items-center justify-center text-sm">Order lines</div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="30%">
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">Cluster · trucks</div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        <Separator className="my-4" />
        <div className="text-muted-foreground flex h-5 items-center gap-3 text-xs">
          Haversine
          <Separator orientation="vertical" />
          25 mph
          <Separator orientation="vertical" />
          seed 0
        </div>
      </Specimen>
    </Group>
  )
}
