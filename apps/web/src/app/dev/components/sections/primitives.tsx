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

const vehicleTypes = ["Box truck", "Cargo van", "Bike courier", "Refrigerated truck"]
const travelModes = [
  { value: "haversine", label: "Haversine (estimated)" },
  { value: "osrm", label: "OSRM road network" },
  { value: "imported", label: "Imported matrix" },
]
const objectives = [
  ["distance", "Total distance"],
  ["duration", "Total duration"],
  ["vehicles", "Vehicles used"],
] as const

export function Primitives({ onOpenCommand }: { onOpenCommand: () => void }) {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 8, 29))
  const [budget, setBudget] = useState(30)
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
              {solving ? "Solving…" : "Solve"}
            </Button>
            <Button variant="outline" disabled={!solving}>
              <Square /> Cancel
            </Button>
          </Row>
          <Row label="Groups & toggles">
            <ToggleGroup defaultValue={["30"]} variant="outline">
              <ToggleGroupItem value="5">5 s</ToggleGroupItem>
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
            <ButtonGroup aria-label="Solve">
              <Button>
                <Play /> Solve
              </Button>
              <GroupSeparator />
              <Button size="icon" aria-label="Solve options">
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
            <Badge variant="success">Feasible</Badge>
            <Badge variant="warning">Approximate</Badge>
            <Badge variant="error">Infeasible</Badge>
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
              Solve
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
              <Input placeholder="Downtown deliveries" />
              <FieldDescription>Shown in the scenario list and exports.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Estimated speed</FieldLabel>
              <InputGroup>
                <InputGroupInput type="number" defaultValue={25} />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>mph</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel>Vehicles</FieldLabel>
              <NumberField defaultValue={3} min={1} max={50}>
                <NumberFieldGroup>
                  <NumberFieldDecrement />
                  <NumberFieldInput />
                  <NumberFieldIncrement />
                </NumberFieldGroup>
              </NumberField>
            </Field>
            <Field>
              <FieldLabel>Search stops</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput placeholder="Label, ID, or address" />
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel>Notes</FieldLabel>
              <Textarea placeholder="What is this experiment testing?" />
            </Field>
            <Field invalid>
              <FieldLabel>Capacity</FieldLabel>
              <Input aria-invalid defaultValue={-4} />
              <FieldError match>Capacity must be ≥ 0.</FieldError>
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
              <FieldLabel>Vehicle type</FieldLabel>
              <Combobox items={vehicleTypes}>
                <ComboboxInput placeholder="Choose a vehicle type" />
                <ComboboxPopup>
                  <ComboboxEmpty>No vehicle types found.</ComboboxEmpty>
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
                Search budget <span className="text-muted-foreground ml-auto font-mono tabular-nums">{budget} s</span>
              </FieldLabel>
              <Slider className="w-full" value={budget} onValueChange={(v) => setBudget(v as number)} min={5} max={300} step={5} />
            </Field>
            <Fieldset>
              <FieldsetLegend className="text-sm">Allocation strategy</FieldsetLegend>
              <RadioGroup defaultValue="priority">
                {[
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
              <FieldsetLegend className="text-sm">Report objectives</FieldsetLegend>
              <CheckboxGroup defaultValue={["distance", "duration"]}>
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
              <Switch /> Show advanced solver parameters
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
                  <SheetTitle>Stop c-03</SheetTitle>
                  <SheetDescription>Inspector drawer used below tablet widths.</SheetDescription>
                </SheetHeader>
                <SheetPanel className="text-muted-foreground text-sm">Stop fields go here.</SheetPanel>
              </SheetPopup>
            </Sheet>

            <Drawer>
              <DrawerTrigger render={<Button variant="outline" />}>Drawer</DrawerTrigger>
              <DrawerPopup showBar>
                <DrawerHeader>
                  <DrawerTitle>Route 2</DrawerTitle>
                  <DrawerDescription>Mobile results drawer.</DrawerDescription>
                </DrawerHeader>
              </DrawerPopup>
            </Drawer>

            <Popover>
              <PopoverTrigger render={<Button variant="outline" />}>Popover</PopoverTrigger>
              <PopoverPopup className="w-72">
                <PopoverTitle className="text-sm">Service duration</PopoverTitle>
                <PopoverDescription className="mt-1">
                  Time spent at the stop. Units: minutes. Model field: <code>service_duration</code>.
                </PopoverDescription>
              </PopoverPopup>
            </Popover>

            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" />}>Tooltip</TooltipTrigger>
              <TooltipPopup>Straight-line estimate, not road geometry</TooltipPopup>
            </Tooltip>

            <PreviewCard>
              <PreviewCardTrigger render={<Button variant="link" />}>run-0142</PreviewCardTrigger>
              <PreviewCardPopup className="space-y-1 text-sm">
                <div className="font-medium">Baseline · seed 0</div>
                <div className="text-muted-foreground font-mono text-xs">PyVRP 0.14.0 · seed 0 · 30 s · haversine@25mph</div>
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
                  <MenuItem>CSV summaries</MenuItem>
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
              onClick={() => toastManager.add({ type: "success", title: "Run queued", description: "Seed 0 · 30 s budget" })}
            >
              Success
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toastManager.add({ type: "info", title: "Matrix cached", description: "Reusing the OSRM matrix from run-0141." })
              }
            >
              Info
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toastManager.add({ type: "warning", title: "2 stops use approximate coordinates", description: "Review before solving." })
              }
            >
              Warning
            </Button>
            <Button
              variant="outline"
              onClick={() => toastManager.add({ type: "error", title: "Solve failed", description: "Worker lease expired after 3 attempts." })}
            >
              Error
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toastManager.promise(new Promise((r) => setTimeout(r, 1800)), {
                  loading: { title: "Building OSRM matrix…", description: "12 / 16 blocks" },
                  success: { title: "Matrix ready", description: "81 nodes · 6,561 pairs" },
                  error: { title: "Matrix failed" },
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
                  title: "Stop c-03 deleted",
                  description: "Saved as an unsaved edit.",
                  actionProps: {
                    children: "Undo",
                    onClick: () => {
                      toastManager.close(id)
                      toastManager.add({ type: "info", title: "Stop c-03 restored" })
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
                  title: "Copied run-0142",
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
                  Right-click a stop
                </ContextMenuTrigger>
                <ContextMenuPopup>
                  <ContextMenuItem>Move to route…</ContextMenuItem>
                  <ContextMenuItem>Edit time window</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive">Delete stop</ContextMenuItem>
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
                  <SidebarGroupLabel>PyVRP Lab</SidebarGroupLabel>
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
                    <BreadcrumbLink href="#">Downtown deliveries</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>v13</BreadcrumbPage>
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
                    <Play /> Solve
                  </ToolbarButton>
                </ToolbarGroup>
              </Toolbar>
            </Row>
            <Row label="Workbench sections">
              <Tabs defaultValue="solve" className="w-full">
                <TabsList>
                  {["Data", "Inventory", "Fleet", "Constraints", "Travel", "Solve", "Results"].map((t) => (
                    <TabsTab key={t} value={t.toLowerCase()}>
                      {t}
                    </TabsTab>
                  ))}
                </TabsList>
                <TabsPanel value="solve" className="text-muted-foreground p-2 text-sm">
                  Solve section content.
                </TabsPanel>
              </Tabs>
            </Row>
            <Row label="Underline tabs">
              <Tabs defaultValue="map">
                <TabsList variant="underline">
                  <TabsTab value="map">Map</TabsTab>
                  <TabsTab value="table">Table</TabsTab>
                  <TabsTab value="timeline">Timeline</TabsTab>
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
                <CardDescription>Total distance</CardDescription>
                <CardTitle className="text-2xl tabular-nums">18.7 mi</CardTitle>
                <CardAction>
                  <Badge variant="outline">Estimated</Badge>
                </CardAction>
              </CardHeader>
              <CardFooter className="text-muted-foreground text-xs">3 routes · 8 of 9 stops</CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Feasibility</CardDescription>
                <CardTitle className="text-2xl">Feasible</CardTitle>
              </CardHeader>
              <CardFooter className="text-muted-foreground text-xs">Best found, not proven optimal</CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Fulfillment</CardDescription>
                <CardTitle className="text-2xl tabular-nums">87%</CardTitle>
              </CardHeader>
              <CardPanel>
                <Meter value={87}>
                  <div className="flex items-center justify-between gap-2">
                    <MeterLabel className="text-muted-foreground text-xs">Units delivered</MeterLabel>
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
                  <FrameDescription>2 vehicle types · 5 vehicles</FrameDescription>
                </FrameHeader>
                {[
                  ["Box truck", "× 3 · capacity [20, 12] · 08:00–17:00 · Main depot"],
                  ["Cargo van", "× 2 · capacity [12, 8] · 09:00–15:00 · Main depot"],
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
                  Advanced solver parameters
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
                  <AccordionTrigger>What is a time window?</AccordionTrigger>
                  <AccordionPanel className="text-muted-foreground">
                    The earliest and latest times service may begin at a stop, in local clock time.
                  </AccordionPanel>
                </AccordionItem>
                <AccordionItem value="field">
                  <AccordionTrigger>Model field</AccordionTrigger>
                  <AccordionPanel className="text-muted-foreground">
                    <code>tw_early</code> / <code>tw_late</code>, in seconds from local midnight.
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>
              <ScrollArea className="bg-card h-32 rounded-xl border text-sm">
                <div className="p-3">
                  {Array.from({ length: 20 }, (_, i) => (
                    <div key={i} className="py-0.5 font-mono text-xs">
                      job_event #{i + 1} · progress {i * 5}%
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
              <AlertTitle>Estimated travel times</AlertTitle>
              <AlertDescription>Haversine at 25 mph. Switch to OSRM for road-network times.</AlertDescription>
              <AlertAction>
                <Button size="xs" variant="ghost">
                  Dismiss
                </Button>
                <Button size="xs">Use OSRM</Button>
              </AlertAction>
            </Alert>
            <Alert variant="info">
              <Info />
              <AlertTitle>Matrix cached</AlertTitle>
              <AlertDescription>Reusing the OSRM matrix from run-0141. No stops changed.</AlertDescription>
            </Alert>
            <Alert variant="success">
              <CircleCheck />
              <AlertTitle>All stops geocoded</AlertTitle>
              <AlertDescription>9 of 9 stops have rooftop coordinates.</AlertDescription>
            </Alert>
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>2 stops use approximate coordinates</AlertTitle>
              <AlertDescription>ZIP/ZCTA fallback was used. Review before solving.</AlertDescription>
            </Alert>
            <Alert variant="error">
              <CircleAlert />
              <AlertTitle>Required stop is unreachable</AlertTitle>
              <AlertDescription>c-09 has no road path from Main depot. Solving is blocked.</AlertDescription>
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
              <EmptyDescription>Solve this scenario to see routes, timeline, and metrics.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button>
                <Play /> Solve
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
                  <div className="text-muted-foreground flex h-full items-center justify-center text-sm">Table / results</div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="30%">
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">Inspector</div>
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
