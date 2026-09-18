program p
  type :: t
    character(len=16) :: name
  end type
  type(t), allocatable :: b
  allocate(b)
  b%name = "hello"
  print *, "P6 OK ", trim(b%name)
end program
