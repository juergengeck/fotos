import React, { useEffect, useRef } from 'react';
import { Trash2, Share2, CheckCircle, Edit3, X } from 'lucide-react';

interface ContextMenuProps {
    x: number;
    y: number;
    type: 'photo' | 'cluster' | 'collection';
    visible: boolean;
    data: any;
    onClose: () => void;
    mobile: boolean;
    
    // Photo Actions
    onDeletePhoto?: (hash: string) => void;
    onToggleSelectPhoto?: (hash: string) => void;
    isPhotoSelected?: (hash: string) => boolean;
    onSharePhoto?: (photo: any) => void;
    
    // Cluster Actions
    onRenameCluster?: (clusterId: string) => void;
    onDeleteCluster?: (clusterId: string) => void;
    
    // Collection Actions
    onRenameCollection?: (collectionId: string) => void;
    onDeleteCollection?: (collectionId: string) => void;
}

export function ContextMenu({
    x,
    y,
    type,
    visible,
    data,
    onClose,
    mobile,
    onDeletePhoto,
    onToggleSelectPhoto,
    isPhotoSelected,
    onSharePhoto,
    onRenameCluster,
    onDeleteCluster,
    onRenameCollection,
    onDeleteCollection,
}: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement | null>(null);

    // Close on escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Position adjustment for desktop so it doesn't overflow screen boundaries
    const getAdjustedStyles = () => {
        if (mobile) return undefined;
        
        const menuWidth = 192; // w-48 is 12rem = 192px
        const menuHeight = 160; // approximate
        
        let adjustedX = x;
        let adjustedY = y;
        
        if (x + menuWidth > window.innerWidth) {
            adjustedX = window.innerWidth - menuWidth - 8;
        }
        if (y + menuHeight > window.innerHeight) {
            adjustedY = window.innerHeight - menuHeight - 8;
        }
        
        return {
            top: `${adjustedY}px`,
            left: `${adjustedX}px`,
        };
    };

    if (!visible || !data) return null;

    return (
        <>
            {/* Backdrop click away */}
            <div 
                className="fixed inset-0 z-[100] bg-black/10 landscape:bg-transparent transition-opacity" 
                onClick={onClose}
            />
            
            {/* Menu panel */}
            <div 
                ref={menuRef}
                className={`
                    z-[101] border border-white/10 bg-[#1a1a1a]/95 backdrop-blur-md shadow-2xl transition-all duration-200
                    ${mobile 
                        ? 'fixed bottom-0 left-0 right-0 rounded-t-2xl p-4 pb-8 animate-slide-up max-h-[50vh] overflow-y-auto' 
                        : 'fixed rounded-lg py-1.5 w-48 text-left animate-[fadeIn_150ms_ease]'
                    }
                `}
                style={getAdjustedStyles()}
            >
                {/* Mobile Header */}
                {mobile && (
                    <div className="flex items-center justify-between border-b border-white/5 pb-2.5 mb-2.5">
                        <span className="text-[10px] font-bold tracking-wider text-white/30 uppercase">
                            {type === 'photo' ? 'Photo Options' : type === 'cluster' ? 'Face Cluster Options' : 'Collection Actions'}
                        </span>
                        <button 
                            type="button"
                            onClick={onClose}
                            className="p-1 rounded-full bg-white/5 text-white/50 hover:text-white/70"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
                
                {/* Content based on type */}
                <div className="space-y-0.5">
                    {type === 'photo' && (
                        <>
                            <MenuBtn 
                                icon={Share2} 
                                label="Share Photo" 
                                mobile={mobile} 
                                onClick={() => {
                                    onSharePhoto?.(data);
                                    onClose();
                                }} 
                            />
                            <MenuBtn 
                                icon={CheckCircle} 
                                label={isPhotoSelected?.(data.hash) ? 'Deselect Photo' : 'Select Photo'} 
                                mobile={mobile} 
                                onClick={() => {
                                    onToggleSelectPhoto?.(data.hash);
                                    onClose();
                                }} 
                            />
                            <div className="h-px bg-white/5 my-1" />
                            <MenuBtn 
                                icon={Trash2} 
                                label="Delete Photo" 
                                mobile={mobile} 
                                destructive
                                onClick={() => {
                                    onDeletePhoto?.(data.hash);
                                    onClose();
                                }} 
                            />
                        </>
                    )}
                    
                    {type === 'cluster' && (
                        <>
                            <MenuBtn 
                                icon={Edit3} 
                                label="Rename Face" 
                                mobile={mobile} 
                                onClick={() => {
                                    onRenameCluster?.(data.clusterId);
                                    onClose();
                                }} 
                            />
                            <div className="h-px bg-white/5 my-1" />
                            <MenuBtn 
                                icon={Trash2} 
                                label="Delete Face Cluster" 
                                mobile={mobile} 
                                destructive
                                onClick={() => {
                                    onDeleteCluster?.(data.clusterId);
                                    onClose();
                                }} 
                            />
                        </>
                    )}
                    
                    {type === 'collection' && (
                        <>
                            <MenuBtn 
                                icon={Edit3} 
                                label="Rename Collection" 
                                mobile={mobile} 
                                onClick={() => {
                                    onRenameCollection?.(data.id);
                                    onClose();
                                }} 
                            />
                            <div className="h-px bg-white/5 my-1" />
                            <MenuBtn 
                                icon={Trash2} 
                                label="Delete Collection" 
                                mobile={mobile} 
                                destructive
                                onClick={() => {
                                    onDeleteCollection?.(data.id);
                                    onClose();
                                }} 
                            />
                        </>
                    )}
                </div>
            </div>
        </>
    );
}

interface MenuBtnProps {
    icon: React.ComponentType<any>;
    label: string;
    mobile: boolean;
    destructive?: boolean;
    onClick: () => void;
}

function MenuBtn({ icon: Icon, label, mobile, destructive = false, onClick }: MenuBtnProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`
                w-full flex items-center gap-3 text-left transition-colors font-medium
                ${mobile 
                    ? 'px-4 py-3 text-sm rounded-xl' 
                    : 'px-3 py-1.5 text-xs'
                }
                ${destructive 
                    ? 'text-red-400 hover:bg-red-500/10' 
                    : 'text-white/80 hover:bg-white/5 hover:text-white'
                }
            `}
        >
            <Icon className={mobile ? 'w-5 h-5 shrink-0' : 'w-3.5 h-3.5 shrink-0'} />
            <span>{label}</span>
        </button>
    );
}
